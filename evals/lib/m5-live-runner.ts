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

/** 真实 API：broken 起点 → QueryEngine → grade；需 ANTHROPIC_API_KEY */
export async function runM5LiveAgent(
  fixturesRoot: string,
  workRoot: string,
  options: { apiKey?: string; model?: string; timeoutMs?: number } = {}
): Promise<M5RunResult[]> {
  const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY required for live M5');
  }
  const results: M5RunResult[] = [];
  for (const taskId of M5_TASKS) {
    const started = Date.now();
    const fixtureRoot = join(fixturesRoot, taskId);
    const workDir = join(workRoot, taskId);
    mkdirSync(workDir, { recursive: true });
    materializeBroken(fixtureRoot, workDir);

    const registry = new ToolRegistry();
    registerCoreTools(registry, {
      task: { toolRegistry: registry, apiKey },
    });

    const engine = new QueryEngine({
      apiKey,
      toolRegistry: registry,
      workingDirectory: workDir,
      permissionPrompt: async () => true,
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
      `Working directory is ${workDir}. Edit files in place. Run verify with: node verify.mjs`,
    ].join('\n');

    const timeoutMs = options.timeoutMs ?? 180_000;
    const deadline = Date.now() + timeoutMs;
    try {
      for await (const _ of engine.query(
        {
          message: prompt,
          options: {
            model: options.model ?? 'claude-sonnet-4-5',
            shouldAbort: () => Date.now() > deadline,
          },
        },
        state
      )) {
        /* drain */
      }
    } catch (e) {
      results.push({
        taskId,
        passed: false,
        message: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - started,
        mode: 'live',
      });
      continue;
    }

    const grade = gradeM5Task(taskId, workDir);
    results.push({
      taskId,
      passed: grade.passed,
      message: grade.message,
      durationMs: Date.now() - started,
      mode: 'live',
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
    tasks: Array<{ id: string; passed: boolean }>;
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
