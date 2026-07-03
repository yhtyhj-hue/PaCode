/**
 * Skills System
 *
 * Markdown-defined skills that LLM decides when to use.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger } from '../pkg/logger/index.js';

export interface Skill {
  name: string;
  description: string;
  whenToUse: string[];
  tools: string[];
  workflow?: string[];
  content: string;
}

export class SkillsLoader {
  private log: Logger;
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();

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
              this.skills.set(skill.name, skill);
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

  private async loadSkill(name: string, path: string): Promise<Skill | null> {
    try {
      const content = readFileSync(path, 'utf-8');
      return this.parseSkillMarkdown(name, content);
    } catch (error) {
      this.log.error(`Failed to load skill ${name}:`, error);
      return null;
    }
  }

  private parseSkillMarkdown(name: string, content: string): Skill {
    const lines = content.split('\n');
    let description = '';
    const whenToUse: string[] = [];
    const tools: string[] = [];
    const workflow: string[] = [];
    let section = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('### When to Use')) {
        section = 'when';
        continue;
      }
      if (trimmed.startsWith('### Tools')) {
        section = 'tools';
        continue;
      }
      if (trimmed.startsWith('### Workflow')) {
        section = 'workflow';
        continue;
      }
      if (trimmed.startsWith('##')) {
        section = '';
        continue;
      }

      if (trimmed.startsWith('- ')) {
        const item = trimmed.slice(2);
        if (section === 'when') whenToUse.push(item);
        else if (section === 'tools') tools.push(item);
        else if (section === 'workflow') workflow.push(item);
        else description += ' ' + item;
      }
    }

    return {
      name: name.replace(/-/g, ' ').replace(/_/g, ' '),
      description: description.trim(),
      whenToUse,
      tools,
      workflow,
      content,
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
