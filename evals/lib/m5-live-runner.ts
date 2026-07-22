/**
 * M5 live / simulated agent runners
 *
 * - simulated：mock Anthropic 经 Write 写入 golden，验证 harness（CI 无 key）
 * - live：真实 QueryEngine + API key
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { QueryEngine } from '../../src/agent/engine.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { registerCoreTools } from '../../src/tools/bootstrap.js';
import { PermissionMode } from '../../src/pkg/types.js';
import { getCCSwitch } from '../../src/pkg/ccswitch/index.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
  toolUseScenario,
} from '../../test/helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from '../../test/helpers/engine-stubs.js';
import {
  M5_TASKS,
  gradeM5Task,
  materializeBroken,
  readTaskPrompt,
} from './m5-grader.js';
import { passthroughCompaction } from '../../test/helpers/engine-stubs.js';
import { mapPool, resolveM5Concurrency } from './m5-speed.js';
import type { ContextAssembler } from '../../src/context/assembler.js';

/** M5 最小 system：少 token、催工具改文件 */
function m5Assembler(): ContextAssembler {
  return {
    async assemble(state: { messages: unknown[] }) {
      return {
        systemPrompt:
          'You are a coding agent. Prefer Edit/Write over long explanations. Finish quickly once verify would pass.',
        messages: state.messages,
        tools: [],
        maxTokens: 8192,
        tokenCount: 80,
      };
    },
  } as unknown as ContextAssembler;
}

export interface M5RunResult {
  taskId: string;
  passed: boolean;
  message: string;
  durationMs: number;
  mode: 'simulated' | 'live';
  /** live 诊断：本轮用过的工具名 */
  toolsUsed?: string[];
  /** live 诊断：engine error 事件 */
  errors?: string[];
  /** live 诊断：助手文本预览 */
  assistantPreview?: string;
}


/** 可选：PACODE_M5_TASKS=fix-bug,add-test 限制 live/sim 任务（诊断用） */
export function resolveM5TaskFilter(defaultTasks: readonly string[]): string[] {
  const raw = process.env['PACODE_M5_TASKS']?.trim();
  if (!raw) return [...defaultTasks];
  const want = raw.split(',').map((t) => t.trim()).filter(Boolean);
  const allowed = new Set(defaultTasks);
  const picked = want.filter((t) => allowed.has(t));
  return picked.length > 0 ? picked : [...defaultTasks];
}

/** 凭证：env 优先，否则 cc-switch active provider（不打印密钥） */
export function resolveM5LiveCredentials(): {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  source: 'env' | 'cc-switch' | 'none';
} {
  const envKey = process.env['ANTHROPIC_API_KEY'];
  if (envKey) {
    return {
      apiKey: envKey,
      baseUrl: process.env['ANTHROPIC_BASE_URL'],
      model: process.env['CLAUDE_MODEL'],
      source: 'env',
    };
  }
  try {
    const creds = getCCSwitch().getCredentials();
    if (creds.apiKey) {
      return {
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl ?? process.env['ANTHROPIC_BASE_URL'],
        model: creds.model ?? process.env['CLAUDE_MODEL'],
        source: 'cc-switch',
      };
    }
  } catch {
    /* ignore */
  }
  return { source: 'none' };
}

function listFilesRecursive(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else {
      out.push(full.slice(base.length + 1).replace(/\\/g, '/'));
    }
  }
  return out;
}

/** 每个 golden 文件一次 Write tool_use，最后 end_turn */
function buildWriteScenarios(fixtureRoot: string) {
  const goldenDir = join(fixtureRoot, 'golden');
  const files = listFilesRecursive(goldenDir);
  const scenarios = files.map((rel, i) =>
    toolUseScenario(`write_${i}`, 'Write', {
      path: rel,
      content: readFileSync(join(goldenDir, rel), 'utf-8'),
    })
  );
  scenarios.push(textEndTurnScenario('Fixed per golden.'));
  return scenarios;
}

/** CI 可跑：mock agent 经 Write 应用 golden，再 grade */
export async function runM5SimulatedAgent(
  fixturesRoot: string,
  workRoot: string,
  options: { tasks?: string[] } = {}
): Promise<M5RunResult[]> {
  const tasks = resolveM5TaskFilter(options.tasks ?? M5_TASKS);
  const results: M5RunResult[] = [];
  for (const taskId of tasks) {
    const started = Date.now();
    const fixtureRoot = join(fixturesRoot, taskId);
    const workDir = join(workRoot, taskId);
    mkdirSync(workDir, { recursive: true });
    materializeBroken(fixtureRoot, workDir);

    const registry = new ToolRegistry();
    registerCoreTools(registry, { task: { toolRegistry: registry } });
    const client = createMockAnthropicClient(buildWriteScenarios(fixtureRoot));

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      workingDirectory: workDir,
      permissionPrompt: async () => true,
    });

    const state = {
      sessionId: `m5-sim-${taskId}`,
      messages: [] as Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>,
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.BYPASS,
      hooks: { hooks: {} },
      compactionHistory: [],
    };

    const prompt = readTaskPrompt(fixtureRoot);
    for await (const _ of engine.query({ message: prompt }, state)) {
      /* drain */
    }

    const grade = gradeM5Task(taskId, workDir);
    results.push({
      taskId,
      passed: grade.passed,
      message: grade.message,
      durationMs: Date.now() - started,
      mode: 'simulated',
    });
  }
  return results;
}

export async function runM5LiveAgent(
  fixturesRoot: string,
  workRoot: string,
  options: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
    tasks?: string[];
    /** 并行任务数；默认 PACODE_M5_CONCURRENCY 或 3 */
    concurrency?: number;
  } = {}
): Promise<M5RunResult[]> {
  const resolved = resolveM5LiveCredentials();
  const apiKey = options.apiKey ?? resolved.apiKey;
  const baseUrl = options.baseUrl ?? resolved.baseUrl;
  const model = options.model ?? resolved.model ?? 'MiniMax-M3';
  if (!apiKey) {
    throw new Error('API key required for live M5 (ANTHROPIC_API_KEY or cc-switch active provider)');
  }
  const tasks = resolveM5TaskFilter(options.tasks ?? M5_TASKS);
  const concurrency = options.concurrency ?? resolveM5Concurrency();
  const timeoutMs = options.timeoutMs ?? 180_000;

  // 并行跑 fixture（限流），墙钟下降；单任务逻辑不变
  return mapPool(tasks, concurrency, async (taskId) => {
    const started = Date.now();
    const fixtureRoot = join(fixturesRoot, taskId);
    const workDir = join(workRoot, taskId);
    mkdirSync(workDir, { recursive: true });
    materializeBroken(fixtureRoot, workDir);

    const registry = new ToolRegistry();
    registerCoreTools(registry, {
      task: { toolRegistry: registry, apiKey, baseUrl, model },
    });
    const m5Tools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
    const filtered = new ToolRegistry();
    for (const name of m5Tools) {
      const t = registry.get(name);
      if (t) filtered.register(t);
    }

    const engine = new QueryEngine({
      apiKey,
      baseUrl,
      toolRegistry: filtered,
      workingDirectory: workDir,
      permissionPrompt: async () => true,
      prefetch: { enabled: false },
      // M5：轻上下文 + 关 reflection，压墙钟
      contextAssembler: m5Assembler(),
      compactionPipeline: passthroughCompaction(),
      disableReflection: true,
    });

    const state = {
      sessionId: `m5-live-${taskId}`,
      messages: [] as Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>,
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.BYPASS,
      hooks: { hooks: {} },
      compactionHistory: [],
    };

    // 短 prompt：保留「必须 Edit/Write + verify」一句
    const prompt = [
      readTaskPrompt(fixtureRoot),
      '',
      'Use Edit/Write (and Read/Bash as needed) in this cwd; harness runs `node verify.mjs`.',
    ].join('\n');

    const toolsUsed: string[] = [];
    const errors: string[] = [];
    let assistantPreview = '';
    const deadline = Date.now() + timeoutMs;
    const maxTokens = Number.parseInt(process.env['PACODE_M5_MAX_TOKENS'] ?? '2048', 10) || 2048;
    let usedToolsThisQuery = false;
    try {
      // 首轮 any：M5 必须改文件，避免 auto 空转一整轮；无 tool 时再强制一轮
      for await (const event of engine.query(
        {
          message: prompt,
          options: {
            model,
            maxTokens,
            toolChoice: 'any',
            shouldAbort: () => Date.now() > deadline,
          },
        },
        state
      )) {
        if (event.type === 'tool_use' && event.tool) {
          toolsUsed.push(event.tool.name);
          usedToolsThisQuery = true;
        } else if (event.type === 'content_block_delta' && event.delta?.text) {
          assistantPreview = (assistantPreview + event.delta.text).slice(0, 400);
        } else if (event.type === 'error' && event.error) {
          errors.push(`${event.error.code ?? 'ERR'}: ${event.error.message}`);
        }
      }

      if (!usedToolsThisQuery && Date.now() < deadline) {
        state.messages.push({
          role: 'user',
          content: 'You must call Edit or Write now to fix the project.',
          timestamp: Date.now(),
        });
        for await (const event of engine.query(
          {
            options: {
              model,
              maxTokens,
              toolChoice: 'any',
              shouldAbort: () => Date.now() > deadline,
            },
          },
          state
        )) {
          if (event.type === 'tool_use' && event.tool) {
            toolsUsed.push(event.tool.name);
          } else if (event.type === 'content_block_delta' && event.delta?.text) {
            assistantPreview = (assistantPreview + event.delta.text).slice(0, 400);
          } else if (event.type === 'error' && event.error) {
            errors.push(`${event.error.code ?? 'ERR'}: ${event.error.message}`);
          }
        }
      }
    } catch (e) {
      return {
        taskId,
        passed: false,
        message: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - started,
        mode: 'live' as const,
        toolsUsed,
        errors,
        assistantPreview,
      };
    }

    const grade = gradeM5Task(taskId, workDir);
    const diag =
      grade.passed
        ? grade.message
        : [
            grade.message.trim(),
            toolsUsed.length ? `tools=${toolsUsed.join(',')}` : 'tools=none',
            errors.length ? `errors=${errors.join(' | ')}` : '',
            assistantPreview ? `assistant=${assistantPreview.slice(0, 160)}` : '',
          ]
            .filter(Boolean)
            .join(' · ');
    return {
      taskId,
      passed: grade.passed,
      message: diag,
      durationMs: Date.now() - started,
      mode: 'live' as const,
      toolsUsed,
      errors,
      assistantPreview,
    };
  });
}

/** 写 BASELINE.json（非密钥） */
export function writeM5Baseline(
  outPath: string,
  payload: {
    passRate: number;
    threshold: number;
    tasks: Array<{
      id: string;
      passed: boolean;
      durationMs?: number;
      message?: string;
    }>;
    note: string;
  }
): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        ...payload,
      },
      null,
      2
    )
  );
}

/** 断言消息：列出失败任务，避免 opaque expected false */
export function formatM5FailureSummary(
  passRate: number,
  threshold: number,
  results: Array<{ id?: string; taskId?: string; passed: boolean; message?: string; durationMs?: number }>
): string {
  const failed = results.filter((r) => !r.passed);
  const lines = [
    `passRate=${passRate} threshold=${threshold} failed=${failed.length}/${results.length}`,
    ...failed.map((r) => {
      const id = r.id ?? r.taskId ?? '?';
      const msg = (r.message ?? '').replace(/\s+/g, ' ').slice(0, 180);
      return `  - ${id} (${r.durationMs ?? '?'}ms): ${msg || '(no message)'}`;
    }),
  ];
  return lines.join('\n');
}
