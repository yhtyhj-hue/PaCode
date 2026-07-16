/**
 * Subagent System — isolated QueryEngine runs (I6: optional git worktree boundary)
 *
 * Prefetch DAG workers are NOT subagents. Real delegation goes through Task → here.
 */

import { QueryEngine, QueryEngineOptions } from './engine.js';
import { PermissionMode, HookType, ToolContext } from '../pkg/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { createFilteredRegistry, registerCoreTools } from '../tools/bootstrap.js';
import { HookRegistry } from '../hooks/registry.js';
import { WorktreeManager, Worktree, getWorktreeManager } from '../cli/worktree.js';

export interface SubagentConfig {
  name: string;
  description: string;
  model?: string;
  mode?: PermissionMode;
  systemPrompt?: string;
  tools?: string[];
}

/** 父 agent 只 merge 此固定 schema，不吞整段对话 */
export interface SubagentReport {
  agent: string;
  success: boolean;
  summary: string;
  toolCalls: number;
  durationMs: number;
  isolation: 'worktree' | 'cwd' | 'none';
  worktree?: { name: string; path: string; kept: boolean };
  error?: string;
}

export interface SubagentResult {
  name: string;
  success: boolean;
  output: string;
  toolCalls: number;
  duration: number;
  error?: string;
  report: SubagentReport;
  worktreePath?: string;
  worktreeName?: string;
}

export interface SubagentRunOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  toolRegistry?: ToolRegistry;
  hookRegistry?: HookRegistry;
  /** 测试注入：自定义 QueryEngine 构造 */
  createEngine?: (options: QueryEngineOptions) => QueryEngine;
  /** 显式 cwd（无 worktree 时使用） */
  workingDirectory?: string;
  /**
   * 在 git worktree 中运行（Task 工具默认开；直接调 Manager 默认关，避免测试污染仓库）。
   * 非 git 仓库或创建失败时回退到 workingDirectory / process.cwd()。
   */
  isolateWorktree?: boolean;
  /** 保留 ephemeral worktree（默认 false = 跑完删除） */
  keepWorktree?: boolean;
  repoRoot?: string;
  /** 测试注入 WorktreeManager */
  worktreeManager?: WorktreeManager;
  /** J1: 父侧 Stop 时中止子 QueryEngine */
  shouldAbort?: () => boolean;
}

/** 禁止嵌套扇出；SendMessage 保留以便 Team 成员协作 */
const NESTED_BLOCKED_TOOLS = new Set([
  'Task',
  'TaskList',
  'TaskGet',
  'TaskStop',
  'TeamCreate',
  'Coordinator',
]);

/** 禁止嵌套 Task/TeamCreate/Coordinator，避免 Subagent 无限扇出 */
export function registryWithoutTask(source: ToolRegistry): ToolRegistry {
  const filtered = new ToolRegistry();
  for (const tool of source.list()) {
    if (NESTED_BLOCKED_TOOLS.has(tool.name)) continue;
    filtered.register(tool);
  }
  return filtered;
}

export function formatSubagentReport(report: SubagentReport): string {
  const header = `[Subagent: ${report.agent}] isolation=${report.isolation} (${report.durationMs}ms, ${report.toolCalls} tools)`;
  const wt = report.worktree
    ? `\nworktree: ${report.worktree.name} @ ${report.worktree.path}${report.worktree.kept ? ' (kept)' : ''}`
    : '';
  const body = report.success
    ? report.summary
    : report.error || report.summary || 'Subagent failed';
  return `${header}${wt}\n\n${body}\n\n---\n${JSON.stringify(report)}`;
}

export class SubagentManager {
  private agents = new Map<string, SubagentConfig>();

  register(config: SubagentConfig): void {
    this.agents.set(config.name, config);
  }

  get(name: string): SubagentConfig | undefined {
    return this.agents.get(name);
  }

  list(): SubagentConfig[] {
    return Array.from(this.agents.values());
  }

  registerDefaults(): void {
    this.register({
      name: 'general-purpose',
      description: 'General-purpose agent for researching and executing complex tasks',
      mode: PermissionMode.DEFAULT,
    });

    this.register({
      name: 'explore',
      description: 'Read-only agent for exploring codebases',
      mode: PermissionMode.ACCEPT_EDITS,
      tools: ['Read', 'Glob', 'Grep'],
    });

    this.register({
      name: 'plan',
      description: 'Planning agent - generates implementation plans without executing',
      mode: PermissionMode.PLAN,
    });

    this.register({
      name: 'security-review',
      description: 'Read-only agent focused on security review of git diffs',
      mode: PermissionMode.DEFAULT,
      tools: ['Read', 'Glob', 'Grep', 'Bash'],
    });
  }

  /** 并行运行多个子代理 — 各自可有独立 worktree */
  async runParallel(
    items: Array<{ config: SubagentConfig; prompt: string; label?: string }>,
    options: SubagentRunOptions = {}
  ): Promise<SubagentResult[]> {
    return Promise.all(
      items.map((item) => this.run(item.config, item.prompt, options))
    );
  }

  async run(
    config: SubagentConfig,
    prompt: string,
    options: SubagentRunOptions = {}
  ): Promise<SubagentResult> {
    const startTime = Date.now();
    let toolCalls = 0;
    let output = '';
    let worktree: Worktree | null = null;
    let isolation: SubagentReport['isolation'] = 'none';
    const keepWorktree = options.keepWorktree === true;
    const wantIsolate = options.isolateWorktree === true;

    const wtManager =
      options.worktreeManager ?? getWorktreeManager(options.repoRoot);
    let workingDirectory = options.workingDirectory ?? process.cwd();

    if (wantIsolate) {
      if (wtManager.isGitRepo()) {
        worktree = wtManager.createEphemeral(`pacode-sub-${config.name}`);
        if (worktree) {
          workingDirectory = worktree.path;
          isolation = 'worktree';
        } else {
          isolation = 'cwd';
        }
      } else {
        isolation = 'cwd';
      }
    } else if (options.workingDirectory) {
      isolation = 'cwd';
    }

    const buildReport = (
      success: boolean,
      summary: string,
      error?: string
    ): SubagentReport => ({
      agent: config.name,
      success,
      summary: summary.slice(0, 8000),
      toolCalls,
      durationMs: Date.now() - startTime,
      isolation,
      worktree: worktree
        ? { name: worktree.name, path: worktree.path, kept: keepWorktree }
        : undefined,
      error,
    });

    const cleanup = (): void => {
      if (worktree && !keepWorktree) {
        wtManager.remove(worktree.name, { deleteBranch: true });
      }
    };

    let result: SubagentResult;

    try {
      const parentRegistry = options.toolRegistry ?? new ToolRegistry();
      let registry =
        config.tools && config.tools.length > 0
          ? createFilteredRegistry(parentRegistry, config.tools)
          : registryWithoutTask(parentRegistry);

      if (registry.list().length === 0) {
        registerCoreTools(registry, {
          task: {
            apiKey: options.apiKey,
            baseUrl: options.baseUrl,
            model: options.model,
            toolRegistry: registry,
          },
        });
        registry = registryWithoutTask(registry);
      }

      const engineOptions: QueryEngineOptions = {
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        toolRegistry: registry,
        hookRegistry: options.hookRegistry,
        workingDirectory,
      };

      const engine =
        options.createEngine?.(engineOptions) ?? new QueryEngine(engineOptions);

      const session = {
        sessionId: `sub-${Date.now()}`,
        messages: [] as Array<{
          role: 'user' | 'assistant' | 'system';
          content: string;
          timestamp: number;
        }>,
        toolCallHistory: [],
        maxOutputTokensRecoveryCount: 0,
        mode: config.mode ?? PermissionMode.DEFAULT,
        hooks: { hooks: {} },
        compactionHistory: [],
      };

      session.messages.push({ role: 'user', content: prompt, timestamp: Date.now() });

      for await (const event of engine.query(
        {
          options: {
            model: options.model ?? config.model,
            systemPrompt: config.systemPrompt,
            shouldAbort: options.shouldAbort,
          },
        },
        session
      )) {
        if (event.type === 'content_block_delta' && event.delta) {
          output += event.delta.text;
        } else if (event.type === 'tool_use') {
          toolCalls++;
        } else if (event.type === 'error') {
          const report = buildReport(
            false,
            output,
            event.error?.message ?? 'Unknown'
          );
          result = {
            name: config.name,
            success: false,
            output: formatSubagentReport(report),
            toolCalls,
            duration: report.durationMs,
            error: report.error,
            report,
            worktreePath: worktree?.path,
            worktreeName: worktree?.name,
          };
          await runSubagentStopHooks(
            options.hookRegistry,
            config,
            result,
            workingDirectory
          );
          cleanup();
          return result;
        }
      }

      const report = buildReport(true, output);
      result = {
        name: config.name,
        success: true,
        output: formatSubagentReport(report),
        toolCalls,
        duration: report.durationMs,
        report,
        worktreePath: worktree?.path,
        worktreeName: worktree?.name,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const report = buildReport(false, output || errMsg, errMsg);
      result = {
        name: config.name,
        success: false,
        output: formatSubagentReport(report),
        toolCalls,
        duration: report.durationMs,
        error: errMsg,
        report,
        worktreePath: worktree?.path,
        worktreeName: worktree?.name,
      };
    }

    await runSubagentStopHooks(
      options.hookRegistry,
      config,
      result,
      workingDirectory
    );
    cleanup();
    return result;
  }
}

/** SubagentStop hook — 子代理结束时触发 */
async function runSubagentStopHooks(
  registry: HookRegistry | undefined,
  config: SubagentConfig,
  _result: SubagentResult,
  workingDirectory: string
): Promise<void> {
  if (!registry) return;

  const ctx: ToolContext = {
    workingDirectory,
    sessionState: {
      sessionId: `subagent-${config.name}`,
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: config.mode ?? PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    },
    hooks: registry,
  };

  const matching = registry.findMatching(HookType.SUBAGENT_STOP, ctx);
  for (const hook of matching) {
    await registry.execute(hook);
  }
}

let instance: SubagentManager | null = null;
export function getSubagentManager(): SubagentManager {
  if (!instance) {
    instance = new SubagentManager();
    instance.registerDefaults();
  }
  return instance;
}

export function resetSubagentManager(): void {
  instance = null;
}
