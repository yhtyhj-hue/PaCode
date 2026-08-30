/**
 * Context Assembler - 10 sources (含 Recent Results)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { SessionState, ModelContext, ToolDefinition } from '../pkg/types.js';
import { MemoryStore } from '../memory/store.js';
import { getTodoStore } from './todo-store.js';
import {
  loadRulesLayers,
  loadProjectContext,
  formatRecentToolResults,
  formatWorkingMemory,
  formatToolCatalog,
  formatSkillsLazyIndex,
  formatSkillsCatalog,
} from './assembler-helpers.js';
import { SkillsLoader } from '../skills/loader.js';
import type { Skill } from '../skills/loader.js';
import { countContextTokens } from './compaction-utils.js';
import { getDefaultAgentSystemPrompt } from '../agent/system-prompt.js';

export interface AssembleOptions {
  systemPrompt?: string;
  tools?: ToolDefinition[];
  /** 预加载的 skills；优先于 skillsLoader */
  skills?: Skill[];
  /** 注入 SkillsLoader（REPL 可共享同一实例） */
  skillsLoader?: SkillsLoader;
  skillsDir?: string;
  /** true 时注入完整 catalog（含 workflow）；默认 lazy index + SkillTool */
  skillsFullCatalog?: boolean;
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

    // 1. System Prompt — 默认 Agent 指令；可追加自定义段落
    const basePrompt = getDefaultAgentSystemPrompt();
    parts.push(options.systemPrompt ? `${basePrompt}\n\n${options.systemPrompt}` : basePrompt);

    // 2. CLAUDE.md
    const claudeMd = await this.loadFile('CLAUDE.md');
    if (claudeMd) parts.push(`## CLAUDE.md\n\n${claudeMd}`);

    // 3. Rules Layer（项目 + 用户级 ~/.claude/rules）
    const projectRules = await this.loadDirectory('.claude/rules');
    const userRules = loadRulesLayers();
    const rulesCombined = [projectRules, userRules].filter(Boolean).join('\n\n---\n\n');
    if (rulesCombined) parts.push(`## Rules\n\n${rulesCombined}`);

    // 4. Skills（K1：默认 lazy index；完整正文走 SkillTool）
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
    // 优先读 cwd 子树最近的 CLAUDE.md(monorepo 子包场景),再回退项目根
    const walkUp = this.findNearestFile(name);
    const projectRoot = [name, `.claude/${name}`, resolve(process.cwd(), name)];
    const paths = walkUp ? [walkUp, ...projectRoot] : projectRoot;
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

  /**
   * 从 cwd 向上走,找最近的 name 文件;找不到返回 null。
   * 例如 cwd=/repo/packages/foo,会在 foo/CLAUDE.md、/repo/packages/CLAUDE.md、
   * /repo/CLAUDE.md 顺序匹配。
   */
  private findNearestFile(name: string): string | null {
    let dir = process.cwd();
    while (true) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) return null; // 抵达根目录
      dir = parent;
    }
  }

  private async loadSkillsContext(options: AssembleOptions): Promise<string | null> {
    let skills: Skill[];
    if (options.skills) {
      skills = options.skills;
    } else {
      const loader =
        options.skillsLoader ?? this.defaultSkillsLoader ?? new SkillsLoader(options.skillsDir);
      if (loader.list().length === 0) {
        // 渐进披露：只索引元数据；全文经 SkillTool 按需加载。
        // skillsFullCatalog 时需要 workflow 全文，才回退 loadAll。
        if (options.skillsFullCatalog) {
          await loader.loadAll();
        } else {
          await loader.loadIndex();
        }
      }
      skills = loader.list();
    }

    if (options.skillsFullCatalog) {
      return formatSkillsCatalog(skills);
    }
    return formatSkillsLazyIndex(skills);
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
    // 向上找最近的 dir(monorepo 子包场景);若全无匹配则回退 cwd
    const dirs = this.walkUpDirectories(dir);
    for (const candidate of dirs) {
      if (existsSync(candidate)) {
        return await this.readDirMd(candidate);
      }
    }
    return null;
  }

  private walkUpDirectories(dir: string): string[] {
    const out: string[] = [];
    let cur = process.cwd();
    while (true) {
      out.push(resolve(cur, dir));
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    return out;
  }

  private async readDirMd(path: string): Promise<string | null> {
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
