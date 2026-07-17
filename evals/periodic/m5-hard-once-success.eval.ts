/**
 * Periodic: M5-hard once-success
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { M5_HARD_TASKS, applyGolden, gradeM5Task, materializeBroken, readTaskPrompt } from '../lib/m5-grader.js';
import { resolveM5LiveCredentials, runM5LiveAgent, runM5SimulatedAgent, writeM5Baseline } from '../lib/m5-live-runner.js';
import { buildSuiteReport, meetsThreshold } from '../lib/types.js';

const FIXTURES = join(process.cwd(), 'evals/fixtures/m5-hard');
const THRESHOLD = 0.5;
const liveCreds = resolveM5LiveCredentials();
const hasLiveCreds = Boolean(liveCreds.apiKey);

describe('eval:periodic:m5-hard-once-success (offline)', () => {
  let workDir: string;
  beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), 'm5h-per-')); });
  afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });
  it('golden solutions meet threshold', () => {
    const results = M5_HARD_TASKS.map((taskId) => {
      const taskDir = join(workDir, taskId);
      materializeBroken(join(FIXTURES, taskId), taskDir);
      applyGolden(join(FIXTURES, taskId), taskDir);
      const grade = gradeM5Task(taskId, taskDir);
      return { id: taskId, lane: 'periodic' as const, passed: grade.passed, score: grade.passed ? 1 : 0, threshold: THRESHOLD, message: grade.message, durationMs: 0 };
    });
    const report = buildSuiteReport('periodic', results);
    writeM5Baseline(join(FIXTURES, 'BASELINE.offline.json'), { threshold: THRESHOLD, passRate: report.passRate, tasks: results.map((r) => ({ id: r.id, passed: r.passed })), note: 'offline golden baseline (m5-hard)' });
    expect(meetsThreshold(report.passRate, THRESHOLD)).toBe(true);
  });
  it('simulated mock agent meets threshold', async () => {
    const runs = await runM5SimulatedAgent(FIXTURES, join(workDir, 'sim'), { tasks: [...M5_HARD_TASKS] });
    const report = buildSuiteReport('periodic', runs.map((r) => ({ id: r.taskId, lane: 'periodic' as const, passed: r.passed, score: r.passed ? 1 : 0, threshold: THRESHOLD, message: r.message, durationMs: r.durationMs })));
    writeM5Baseline(join(FIXTURES, 'BASELINE.simulated.json'), { threshold: THRESHOLD, passRate: report.passRate, tasks: report.results.map((r) => ({ id: r.id, passed: r.passed })), note: 'simulated mock agent (m5-hard)' });
    expect(meetsThreshold(report.passRate, THRESHOLD)).toBe(true);
  });
  it('task prompts exist', () => {
    for (const taskId of M5_HARD_TASKS) expect(readTaskPrompt(join(FIXTURES, taskId)).length).toBeGreaterThan(10);
  });
});

describe.skipIf(!hasLiveCreds)('eval:periodic:m5-hard-once-success (live)', () => {
  let workDir: string;
  beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), 'm5h-live-')); });
  afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });
  it('live QueryEngine meets hard once-success threshold', async () => {
    const runs = await runM5LiveAgent(FIXTURES, workDir, { timeoutMs: 180_000, apiKey: liveCreds.apiKey, baseUrl: liveCreds.baseUrl, model: liveCreds.model, tasks: [...M5_HARD_TASKS] });
    const report = buildSuiteReport('periodic', runs.map((r) => ({ id: r.taskId, lane: 'periodic' as const, passed: r.passed, score: r.passed ? 1 : 0, threshold: THRESHOLD, message: r.message, durationMs: r.durationMs })));
    writeM5Baseline(join(FIXTURES, 'BASELINE.json'), { threshold: THRESHOLD, passRate: report.passRate, tasks: runs.map((r) => ({ id: r.taskId, passed: r.passed, durationMs: r.durationMs, message: r.message.slice(0, 200) })), note: `live agent m5-hard via ${liveCreds.source} (model=${liveCreds.model ?? 'default'})` });
    expect(meetsThreshold(report.passRate, THRESHOLD)).toBe(true);
  }, 600_000);
});
