/**
 * Context Assembler - 9 sources
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SessionState, ModelContext, ToolDefinition } from '../pkg/types.js';
import { MemoryStore } from '../memory/store.js';
import { getTodoStore } from './todo-store.js';
import {
  loadRulesLayers,
  loadProjectContext,
  formatRecentToolResults,
  formatWorkingMemory,
  formatToolCatalog,
  formatSkillsCatalog,
} from './assembler-helpers.js';
import { SkillsLoader } from '../skills/loader.js';
import type { Skill } from '../skills/loader.js';
import { countContextTokens } from './compaction-utils.js';

export interface AssembleOptions {
  systemPrompt?: string;
  tools?: ToolDefinition[];
  /** 预加载的 skills；优先于 skillsLoader */
  skills?: Skill[];
  /** 注入 SkillsLoader（REPL 可共享同一实例） */
  skillsLoader?: SkillsLoader;
  skillsDir?: string;
}

export class ContextAssembler {
  private memoryDir?: string;
  private defaultSkillsLoader?: SkillsLoader;

  constructor(options: { memoryDir?: string; skillsLoader?: SkillsLoader } = {}) {
    this.memoryDir = options.memoryDir;
    this.defaultSkillsLoader = options.skillsLoader;
  }

  async assemble(state: SessionState, options: AssembleOptions = {}): Promise<ModelContext> {
    const parts: string[] = [];

    // 1. System Prompt
    if (options.systemPrompt) {
      parts.push(options.systemPrompt);
    }

    // 2. CLAUDE.md
    const claudeMd = await this.loadFile('CLAUDE.md');
    if (claudeMd) parts.push(`## CLAUDE.md\n\n${claudeMd}`);

    // 3. Rules Layer（项目 + 用户级 ~/.claude/rules）
    const projectRules = await this.loadDirectory('.claude/rules');
    const userRules = loadRulesLayers();
    const rulesCombined = [projectRules, userRules].filter(Boolean).join('\n\n---\n\n');
    if (rulesCombined) parts.push(`## Rules\n\n${rulesCombined}`);

    // 4. Skills（SkillsLoader 结构化元数据，非原始 markdown 拼接）
    const skillsContext = await this.loadSkillsContext(options);
    if (skillsContext) parts.push(`## Skills\n\n${skillsContext}`);

    // 5. Working Memory
    const workingMemory = formatWorkingMemory(state.messages);
    if (workingMemory) parts.push(`## Working Memory\n\n${workingMemory}`);

    // 6. Task Context（TodoWrite 持久化）
    const taskContext = getTodoStore().formatForContext(state.sessionId);
    if (taskContext) parts.push(`## Task Context\n\n${taskContext}`);

    // 7. MCP Tools 摘要
    const toolCatalog = formatToolCatalog(options.tools ?? []);
    if (toolCatalog) parts.push(`## Available Tools\n\n${toolCatalog}`);

    // 8. Project Context
    const projectContext = loadProjectContext();
    if (projectContext) parts.push(`## Project\n\n${projectContext}`);

    // Memory（用户偏好/模式）
    const memory = await this.loadMemory();
    if (memory) parts.push(`## Memory\n\n${memory}`);

    // 9. Recent Results
    const recentResults = formatRecentToolResults(state.messages);
    if (recentResults) parts.push(`## Recent Results\n\n${recentResults}`);

    const systemPrompt = parts.join('\n\n');
    const tools = options.tools ?? [];

    return {
      systemPrompt,
      messages: state.messages,
      tools,
      maxTokens: 8192,
      tokenCount: countContextTokens(systemPrompt, state.messages),
    };
  }

  private async loadFile(name: string): Promise<string | null> {
    const paths = [name, `.claude/${name}`, resolve(process.cwd(), name)];
    for (const p of paths) {
      if (existsSync(p)) {
        try {
          return readFileSync(p, 'utf-8');
        } catch {
          /* continue */
        }
      }
    }
    return null;
  }

  private async loadSkillsContext(options: AssembleOptions): Promise<string | null> {
    if (options.skills) {
      return formatSkillsCatalog(options.skills);
    }

    const loader =
      options.skillsLoader ?? this.defaultSkillsLoader ?? new SkillsLoader(options.skillsDir);
    if (loader.list().length === 0) {
      await loader.loadAll();
    }

    return formatSkillsCatalog(loader.list());
  }

  private async loadMemory(): Promise<string | null> {
    try {
      const memStore = new MemoryStore({
        memoryDir: this.memoryDir,
        includeProject: true,
      });
      return await memStore.formatForContext(10);
    } catch {
      return null;
    }
  }

  private async loadDirectory(dir: string): Promise<string | null> {
    const path = resolve(process.cwd(), dir);
    if (!existsSync(path)) return null;
    try {
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(path).filter((f) => f.endsWith('.md'));
      const contents: string[] = [];
      for (const f of files) {
        contents.push(readFileSync(join(path, f), 'utf-8'));
      }
      return contents.join('\n\n---\n\n');
    } catch {
      return null;
    }
  }
}
