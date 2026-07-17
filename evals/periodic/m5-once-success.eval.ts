/**
 * Periodic eval: M5 一次成功率基线
 *
 * 无 API key：离线跑 golden 自检，记录基线分子。
 * 有 API key：预留真实 Agent 跑 fixture 的扩展点（当前仍用 golden 校准 harness）。
 *
 * 基线目标：passRate ≥ 0.5（3 任务至少 2 过）；随后持续提高。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  M5_TASKS,
  applyGolden,
  gradeM5Task,
  materializeBroken,
  readTaskPrompt,
} from '../lib/m5-grader.js';
import { buildSuiteReport, meetsThreshold } from '../lib/types.js';

const FIXTURES = join(process.cwd(), 'evals/fixtures/m5');
const BASELINE_THRESHOLD = 0.5;
const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

describe('eval:periodic:m5-once-success (offline baseline)', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'm5-per-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('golden solutions meet baseline threshold (fixture integrity)', () => {
    const results = M5_TASKS.map((taskId) => {
      const taskDir = join(workDir, taskId);
      mkdirSync(taskDir, { recursive: true });
      const root = join(FIXTURES, taskId);
      materializeBroken(root, taskDir);
      applyGolden(root, taskDir);
      const grade = gradeM5Task(taskId, taskDir);
      return {
        id: taskId,
        lane: 'periodic' as const,
        passed: grade.passed,
        score: grade.passed ? 1 : 0,
        threshold: BASELINE_THRESHOLD,
        message: grade.message,
        durationMs: 0,
      };
    });

    const report = buildSuiteReport('periodic', results);
    // 写入可检查的基线快照（非密钥）
    const out = join(process.cwd(), 'evals/fixtures/m5/BASELINE.json');
    writeFileSync(
      out,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          threshold: BASELINE_THRESHOLD,
          passRate: report.passRate,
          tasks: results.map((r) => ({ id: r.id, passed: r.passed })),
          note: hasApiKey
            ? 'API key present; agent live run not yet wired — golden baseline recorded'
            : 'offline golden baseline',
        },
        null,
        2
      )
    );

    expect(meetsThreshold(report.passRate, BASELINE_THRESHOLD)).toBe(true);
    expect(report.passRate).toBe(1);
  });

  it('task prompts exist for agent wiring', () => {
    for (const taskId of M5_TASKS) {
      const prompt = readTaskPrompt(join(FIXTURES, taskId));
      expect(prompt.length).toBeGreaterThan(10);
    }
  });
});

describe.skipIf(!hasApiKey)('eval:periodic:m5-once-success (live agent)', () => {
  it('placeholder: live QueryEngine per fixture not yet enabled', () => {
    // 后续：对每个 fixture materializeBroken → QueryEngine(TASK.md) → gradeM5Task
    expect(hasApiKey).toBe(true);
  });
});
