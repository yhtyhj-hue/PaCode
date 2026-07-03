/**
 * Context Assembler - 9 sources
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SessionState, ModelContext } from '../pkg/types.js';

export class ContextAssembler {
  async assemble(state: SessionState, options: { systemPrompt?: string } = {}): Promise<ModelContext> {
    const parts: string[] = [];

    if (options.systemPrompt) {
      parts.push(options.systemPrompt);
    }

    const claudeMd = await this.loadFile('CLAUDE.md');
    if (claudeMd) parts.push(`## CLAUDE.md\n\n${claudeMd}`);

    const rules = await this.loadDirectory('.claude/rules');
    if (rules) parts.push(`## Rules\n\n${rules}`);

    const skills = await this.loadDirectory('.claude/skills');
    if (skills) parts.push(`## Skills\n\n${skills}`);

    const systemPrompt = parts.join('\n\n');

    return {
      systemPrompt,
      messages: state.messages,
      tools: [],
      maxTokens: 8192,
      tokenCount: Math.ceil(systemPrompt.length / 4),
    };
  }

  private async loadFile(name: string): Promise<string | null> {
    const paths = [name, `.claude/${name}`, resolve(process.cwd(), name)];
    for (const p of paths) {
      if (existsSync(p)) {
        try {
          return readFileSync(p, 'utf-8');
        } catch { /* continue */ }
      }
    }
    return null;
  }

  private async loadDirectory(dir: string): Promise<string | null> {
    const path = resolve(process.cwd(), dir);
    if (!existsSync(path)) return null;
    try {
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(path).filter(f => f.endsWith('.md'));
      const contents: string[] = [];
      for (const f of files) {
        contents.push(readFileSync(join(path, f), 'utf-8'));
      }
      return contents.join('\n\n---\n\n');
    } catch { return null; }
  }
}
