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
  type M5TaskId,
  gradeM5Task,
  materializeBroken,
  readTaskPrompt,
} from './m5-grader.js';

export interface M5RunResult {
  taskId: M5TaskId;
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
  workRoot: string
): Promise<M5RunResult[]> {
  const results: M5RunResult[] = [];
  for (const taskId of M5_TASKS) {
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
  } = {}
): Promise<M5RunResult[]> {
  const resolved = resolveM5LiveCredentials();
  const apiKey = options.apiKey ?? resolved.apiKey;
  const baseUrl = options.baseUrl ?? resolved.baseUrl;
  const model = options.model ?? resolved.model ?? 'claude-sonnet-4-5';
  if (!apiKey) {
    throw new Error('API key required for live M5 (ANTHROPIC_API_KEY or cc-switch active provider)');
  }
  const results: M5RunResult[] = [];
  for (const taskId of M5_TASKS) {
    const started = Date.now();
    const fixtureRoot = join(fixturesRoot, taskId);
    const workDir = join(workRoot, taskId);
    mkdirSync(workDir, { recursive: true });
    materializeBroken(fixtureRoot, workDir);

    const registry = new ToolRegistry();
    // M5：精简工具，避免本地代理因 tools schema 过大而静默丢掉 tool_choice
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
      // M5：关预取，逼模型真改 fixture
      prefetch: { enabled: false },
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

    const prompt = [
      readTaskPrompt(fixtureRoot),
      '',
      `Working directory is already set to the project root (tools run there).`,
      `You MUST use Read/Edit/Write/Bash tools to change files — never only describe a plan.`,
      `When finished, the harness runs: node verify.mjs`,
    ].join('\n');

    const toolsUsed: string[] = [];
    const errors: string[] = [];
    let assistantPreview = '';
    const timeoutMs = options.timeoutMs ?? 180_000;
    const deadline = Date.now() + timeoutMs;
    try {
      for await (const event of engine.query(
        {
          message: prompt,
          options: {
            model,
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
    } catch (e) {
      results.push({
        taskId,
        passed: false,
        message: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - started,
        mode: 'live',
        toolsUsed,
        errors,
        assistantPreview,
      });
      continue;
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
    results.push({
      taskId,
      passed: grade.passed,
      message: diag,
      durationMs: Date.now() - started,
      mode: 'live',
      toolsUsed,
      errors,
      assistantPreview,
    });
  }
  return results;
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
