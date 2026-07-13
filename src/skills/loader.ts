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

export interface Skill {
  name: string;
  description: string;
  whenToUse: string[];
  tools: string[];
  workflow?: string[];
  content: string;
  source?: string;
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

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  match(query: string): Skill[] {
    const lower = query.toLowerCase();
    const skills = Array.from(this.skills.values());
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.whenToUse.some((w) => w.toLowerCase().includes(lower))
    );
  }
}
