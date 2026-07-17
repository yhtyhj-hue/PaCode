/**
 * Periodic eval: M5 一次成功率
 *
 * - 离线：golden 自检 + simulated mock agent
 * - 有凭证（env 或 cc-switch）：live QueryEngine，passRate ≥ 0.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  M5_TASKS,
  applyGolden,
  gradeM5Task,
  materializeBroken,
  readTaskPrompt,
} from '../lib/m5-grader.js';
import {
  resolveM5LiveCredentials,
  runM5LiveAgent,
  runM5SimulatedAgent,
  writeM5Baseline,
} from '../lib/m5-live-runner.js';
import { buildSuiteReport, meetsThreshold } from '../lib/types.js';

const FIXTURES = join(process.cwd(), 'evals/fixtures/m5');
const BASELINE_THRESHOLD = 0.5;
const liveCreds = resolveM5LiveCredentials();
const hasLiveCreds = Boolean(liveCreds.apiKey);

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
      materializeBroken(join(FIXTURES, taskId), taskDir);
      applyGolden(join(FIXTURES, taskId), taskDir);
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
    writeM5Baseline(join(FIXTURES, 'BASELINE.json'), {
      threshold: BASELINE_THRESHOLD,
      passRate: report.passRate,
      tasks: results.map((r) => ({ id: r.id, passed: r.passed })),
      note: 'offline golden baseline',
    });

    expect(meetsThreshold(report.passRate, BASELINE_THRESHOLD)).toBe(true);
    expect(report.passRate).toBe(1);
  });

  it('simulated mock agent Write→grade meets threshold (harness wiring)', async () => {
    const simRoot = join(workDir, 'sim');
    const runs = await runM5SimulatedAgent(FIXTURES, simRoot);
    const results = runs.map((r) => ({
      id: r.taskId,
      lane: 'periodic' as const,
      passed: r.passed,
      score: r.passed ? 1 : 0,
      threshold: BASELINE_THRESHOLD,
      message: r.message,
      durationMs: r.durationMs,
    }));
    const report = buildSuiteReport('periodic', results);
    writeM5Baseline(join(FIXTURES, 'BASELINE.json'), {
      threshold: BASELINE_THRESHOLD,
      passRate: report.passRate,
      tasks: results.map((r) => ({ id: r.id, passed: r.passed })),
      note: 'simulated mock agent (Write golden)',
    });
    expect(meetsThreshold(report.passRate, BASELINE_THRESHOLD)).toBe(true);
    expect(report.passRate).toBe(1);
  });

  it('task prompts exist for agent wiring', () => {
    for (const taskId of M5_TASKS) {
      const prompt = readTaskPrompt(join(FIXTURES, taskId));
      expect(prompt.length).toBeGreaterThan(10);
    }
  });

  it('resolveM5LiveCredentials reports source without leaking secrets', () => {
    const c = resolveM5LiveCredentials();
    expect(['env', 'cc-switch', 'none']).toContain(c.source);
    // 绝不把密钥写入断言消息
    expect(JSON.stringify(c)).not.toMatch(/sk-ant-/);
  });
});

describe.skipIf(!hasLiveCreds)('eval:periodic:m5-once-success (live agent)', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'm5-live-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it(
    'live QueryEngine meets once-success threshold on fixtures',
    async () => {
      const runs = await runM5LiveAgent(FIXTURES, workDir, {
        timeoutMs: 180_000,
        apiKey: liveCreds.apiKey,
        baseUrl: liveCreds.baseUrl,
        model: liveCreds.model,
      });
      const results = runs.map((r) => ({
        id: r.taskId,
        lane: 'periodic' as const,
        passed: r.passed,
        score: r.passed ? 1 : 0,
        threshold: BASELINE_THRESHOLD,
        message: r.message,
        durationMs: r.durationMs,
      }));
      const report = buildSuiteReport('periodic', results);
      writeM5Baseline(join(FIXTURES, 'BASELINE.json'), {
        threshold: BASELINE_THRESHOLD,
        passRate: report.passRate,
        tasks: results.map((r) => ({
          id: r.id,
          passed: r.passed,
          durationMs: r.durationMs,
          message: r.message.slice(0, 200),
        })),
        note: `live agent via ${liveCreds.source} (model=${liveCreds.model ?? 'default'})`,
      });
      expect(meetsThreshold(report.passRate, BASELINE_THRESHOLD)).toBe(true);
    },
    600_000
  );
});
