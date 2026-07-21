/**
 * Skills System
 *
 * Markdown-defined skills that LLM decides when to use.
 * Also supports custom slash commands from .claude/commands/
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Logger } from '../pkg/logger/index.js';
import {
  loadExternalSkills,
  type MountedSkill,
  type SkillMountConfig,
} from '../services/skill-mount/index.js';

export interface Skill {
  name: string;
  description: string;
  whenToUse: string[];
  tools: string[];
  workflow?: string[];
  content: string;
  source?: string;
  /** 全文所在路径（渐进披露：loadContent 按需读取）。 */
  contentPath?: string;
  /** true 表示 content 仅为元数据摘要，全文尚未加载。 */
  indexOnly?: boolean;
}

export interface SlashCommand {
  name: string; // e.g., "review" -> /review
  description: string;
  prompt: string; // Markdown content
  argumentHint?: string;
  source: string;
}

export class SkillsLoader {
  private log: Logger;
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();
  private slashCommands: Map<string, SlashCommand> = new Map();

  constructor(skillsDir?: string) {
    this.log = new Logger({ prefix: 'SkillsLoader' });
    this.skillsDir = skillsDir ?? '.claude/skills';
  }

  async loadAll(): Promise<Map<string, Skill>> {
    const basePath = resolve(process.cwd(), this.skillsDir);

    if (!existsSync(basePath)) {
      this.log.debug(`Skills directory not found: ${basePath}`);
      return this.skills;
    }

    try {
      const entries = readdirSync(basePath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = join(basePath, entry.name, 'SKILL.md');
          if (existsSync(skillPath)) {
            const skill = await this.loadSkill(entry.name, skillPath);
            if (skill) {
              skill.source = entry.name;
              this.skills.set(entry.name, skill);
            }
          }
        }
      }

      this.log.info(`Loaded ${this.skills.size} skills`);
    } catch (error) {
      this.log.error('Failed to load skills:', error);
    }

    return this.skills;
  }

  /**
   * 渐进披露 (progressive disclosure)：只解析每个 SKILL.md 的元数据
   * (name / description / whenToUse / tools / workflow)，不把全文正文驻留内存。
   * 全文经 loadContent() 按需读取。对标 Claude Code 的 Skills 索引模型。
   */
  async loadIndex(): Promise<Map<string, Skill>> {
    const basePath = resolve(process.cwd(), this.skillsDir);

    if (!existsSync(basePath)) {
      this.log.debug(`Skills directory not found: ${basePath}`);
      return this.skills;
    }

    try {
      const entries = readdirSync(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = join(basePath, entry.name, 'SKILL.md');
        if (!existsSync(skillPath)) continue;
        const skill = this.loadSkillIndex(entry.name, skillPath);
        if (skill) this.skills.set(entry.name, skill);
      }
      this.log.info(`Indexed ${this.skills.size} skills (metadata only)`);
    } catch (error) {
      this.log.error('Failed to index skills:', error);
    }

    return this.skills;
  }

  /**
   * 按需读取指定 skill 的完整 SKILL.md 正文，并回填到索引条目缓存。
   * 返回全文；未知 skill 返回 null。
   */
  async loadContent(query: string): Promise<string | null> {
    const skill = this.resolve(query);
    if (!skill) return null;
    if (!skill.indexOnly && skill.content) return skill.content;

    const path = skill.contentPath;
    if (!path || !existsSync(path)) return skill.content || null;

    try {
      const content = readFileSync(path, 'utf-8');
      const id = skill.source ?? skill.name;
      const full = this.parseSkillMarkdown(id, content);
      const merged: Skill = { ...full, source: skill.source, contentPath: path, indexOnly: false };
      this.skills.set(id, merged);
      return content;
    } catch (error) {
      this.log.error(`Failed to load skill content ${query}:`, error);
      return skill.content || null;
    }
  }

  /** 解析 SKILL.md 元数据但丢弃全文正文（渐进披露索引条目）。 */
  private loadSkillIndex(dirName: string, path: string): Skill | null {
    try {
      const content = readFileSync(path, 'utf-8');
      const parsed = this.parseSkillMarkdown(dirName, content);
      return {
        ...parsed,
        content: '', // 不驻留全文
        contentPath: path,
        indexOnly: true,
        source: dirName,
      };
    } catch (error) {
      this.log.error(`Failed to index skill ${dirName}:`, error);
      return null;
    }
  }

  /**
   * Load skills from external sources via skill-mount layer.
   * Merges with existing skills in this.skills; conflicts are logged
   * (existing project/user skill wins over external by default).
   */
  async loadFromExternal(config: SkillMountConfig): Promise<Map<string, Skill>> {
    try {
      const result = await loadExternalSkills(config);
      for (const warning of result.warnings) {
        this.log.warn(
          `Skill '${warning.id}' conflict: ${warning.overriddenSource} (${warning.overriddenPath}) overridden by ${warning.winningSource} (${warning.winningPath})`
        );
      }
      for (const mounted of result.skills) {
        const skill = mountedToSkill(mounted);
        // Don't let external override already-loaded project/user skills
        if (!this.skills.has(skill.name)) {
          this.skills.set(skill.name, skill);
        }
      }
      this.log.info(
        `Loaded ${result.skills.length} external skills (${this.skills.size} total)`
      );
    } catch (error) {
      this.log.error('Failed to load external skills:', error);
    }
    return this.skills;
  }

  /** Default external skill roots (project > user > everything-claude-code). */
  defaultExternalConfig(): SkillMountConfig {
    const home = homedir();
    return {
      roots: [
        { root: resolve(process.cwd(), '.paude/skills'), kind: 'project' },
        { root: resolve(process.cwd(), '.claude/skills'), kind: 'project' },
        { root: join(home, '.paude/skills'), kind: 'user' },
        { root: join(home, 'everything-claude-code/skills'), kind: 'external' },
      ],
    };
  }

  /**
   * Load custom slash commands from .claude/commands/*.md
   * Also check ~/.claude/commands/*.md (user-level)
   */
  async loadSlashCommands(): Promise<Map<string, SlashCommand>> {
    await this._loadSlashCommands();
    return this.slashCommands;
  }

  private async _loadSlashCommands(): Promise<void> {
    const dirs = [resolve(process.cwd(), '.claude/commands'), join(homedir(), '.claude/commands')];

    for (const dir of dirs) {
      if (!existsSync(dir)) continue;

      try {
        const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
        for (const file of files) {
          const name = file.replace(/\.md$/, '');
          const path = join(dir, file);
          const cmd = this.loadSlashCommand(name, path);
          if (cmd) {
            // User-level commands don't override project-level
            if (!this.slashCommands.has(cmd.name)) {
              this.slashCommands.set(cmd.name, cmd);
            }
          }
        }
      } catch (e) {
        this.log.error(`Failed to load commands from ${dir}:`, e);
      }
    }

    this.log.info(`Loaded ${this.slashCommands.size} custom commands`);
  }

  private loadSlashCommand(name: string, path: string): SlashCommand | null {
    try {
      const content = readFileSync(path, 'utf-8');
      const lines = content.split('\n');

      let description = '';
      let argumentHint: string | undefined;
      let promptBody = '';
      let inFrontmatter = false;
      let frontmatterEnd = false;

      for (const line of lines) {
        if (line.trim() === '---') {
          if (!inFrontmatter) {
            inFrontmatter = true;
          } else {
            frontmatterEnd = true;
            continue;
          }
          continue;
        }

        if (inFrontmatter && !frontmatterEnd) {
          const match = line.match(/^(\w+):\s*(.*)$/);
          if (match) {
            const [, key, value] = match;
            if (key === 'description') description = value ?? '';
            if (key === 'argument-hint') argumentHint = value ?? undefined;
          }
          continue;
        }

        promptBody += line + '\n';
      }

      return {
        name,
        description: description || `Custom command: ${name}`,
        prompt: promptBody.trim(),
        argumentHint,
        source: path,
      };
    } catch (e) {
      this.log.error(`Failed to load command ${name}:`, e);
      return null;
    }
  }

  getSlashCommand(name: string): SlashCommand | undefined {
    return this.slashCommands.get(name);
  }

  listSlashCommands(): SlashCommand[] {
    return Array.from(this.slashCommands.values());
  }

  private async loadSkill(dirName: string, path: string): Promise<Skill | null> {
    try {
      const content = readFileSync(path, 'utf-8');
      return this.parseSkillMarkdown(dirName, content);
    } catch (error) {
      this.log.error(`Failed to load skill ${dirName}:`, error);
      return null;
    }
  }

  /** 解析 SKILL.md 各段落为结构化元数据 */
  private parseSkillMarkdown(dirName: string, content: string): Skill {
    const lines = content.split('\n');
    let title = dirName.replace(/-/g, ' ').replace(/_/g, ' ');
    let description = '';
    const whenToUse: string[] = [];
    const tools: string[] = [];
    const workflow: string[] = [];
    let section = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (/^#\s+/.test(trimmed) && !/^##/.test(trimmed)) {
        title = trimmed.replace(/^#\s+/, '').trim();
        continue;
      }

      const sectionMatch = trimmed.match(/^##\s+(.+)$/);
      if (sectionMatch) {
        const sectionName = sectionMatch[1]!.toLowerCase();
        if (sectionName.includes('description')) section = 'description';
        else if (sectionName.includes('when')) section = 'when';
        else if (sectionName.includes('tools')) section = 'tools';
        else if (sectionName.includes('workflow')) section = 'workflow';
        else section = '';
        continue;
      }

      if (!trimmed || trimmed.startsWith('#')) continue;

      if (section === 'description') {
        description += (description ? ' ' : '') + trimmed;
        continue;
      }

      if (section === 'when' && trimmed.startsWith('- ')) {
        whenToUse.push(trimmed.slice(2));
        continue;
      }

      if (section === 'tools' && trimmed.startsWith('- ')) {
        tools.push(trimmed.slice(2));
        continue;
      }

      if (section === 'workflow') {
        const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
        if (numbered) workflow.push(numbered[1]!);
        else if (trimmed.startsWith('- ')) workflow.push(trimmed.slice(2));
      }
    }

    return {
      name: title,
      description: description.trim(),
      whenToUse,
      tools,
      workflow,
      content,
      source: dirName,
    };
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** 按目录 id 或展示名解析（SkillTool 用） */
  resolve(query: string): Skill | undefined {
    const q = query.trim();
    if (!q) return undefined;
    const exact = this.skills.get(q);
    if (exact) return exact;
    const lower = q.toLowerCase();
    for (const [id, skill] of this.skills) {
      if (id.toLowerCase() === lower) return skill;
      if (skill.name.toLowerCase() === lower) return skill;
    }
    const matches = this.match(q);
    return matches.length === 1 ? matches[0] : undefined;
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** 索引条目（不含全文） */
  listIndex(): Array<{ id: string; name: string; description: string }> {
    return Array.from(this.skills.entries()).map(([id, s]) => ({
      id,
      name: s.name,
      description: s.description,
    }));
  }

  match(query: string): Skill[] {
    const lower = query.toLowerCase();
    const skills = Array.from(this.skills.values());
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.whenToUse.some((w) => w.toLowerCase().includes(lower)) ||
        (s.source?.toLowerCase().includes(lower) ?? false)
    );
  }
}

/** Adapter: skill-mount MountedSkill → SkillsLoader Skill. */
function mountedToSkill(mounted: MountedSkill): Skill {
  const fm = mounted.frontmatter;
  // skill-mount parser collects under 'when_to_use' / 'tools' (snake_case
  // key recognition) but may also surface camelCase aliases via .extra.
  // Accept both so adapters stay robust to either form.
  const whenToUse =
    fm.whenToUse ??
    (fm.extra['whenToUse'] ? fm.extra['whenToUse'].split(',').map((s) => s.trim()).filter(Boolean) : undefined) ??
    (fm.extra['when_to_use'] ? fm.extra['when_to_use'].split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  const tools =
    fm.tools ??
    (fm.extra['tools'] ? fm.extra['tools'].split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  return {
    name: fm.name ?? mounted.name,
    description: fm.description ?? '',
    whenToUse: whenToUse ?? [],
    tools: tools ?? [],
    workflow: undefined,
    content: mounted.content,
    source: `${mounted.source}:${mounted.originPath}`,
  };
}
