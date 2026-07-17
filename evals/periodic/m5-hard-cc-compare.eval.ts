/**
 * Periodic: M5-hard PaCode vs Claude Code
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { M5_HARD_TASKS } from '../lib/m5-grader.js';
import { meetsThreshold } from '../lib/types.js';
import { resolveM5LiveCredentials, runM5LiveAgent } from '../lib/m5-live-runner.js';
import { buildM5CompareReport, readClaudeVersion, resolveClaudeCli, runM5ClaudeCodeAgent, writeM5CompareReport } from '../lib/m5-cc-runner.js';

const FIXTURES = join(process.cwd(), 'evals/fixtures/m5-hard');
const THRESHOLD = 0.5;
const liveCreds = resolveM5LiveCredentials();
const claudeCli = resolveClaudeCli();
const canCompare = Boolean(liveCreds.apiKey && claudeCli);

describe.skipIf(!canCompare)('eval:periodic:m5-hard-cc-compare', () => {
  let workDir: string;
  beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), 'm5h-cmp-')); });
  afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });
  it('PaCode and Claude Code hard suite both meet threshold', async () => {
    const tasks = [...M5_HARD_TASKS];
    const pacodeRuns = await runM5LiveAgent(FIXTURES, join(workDir, 'pacode'), { timeoutMs: 180_000, apiKey: liveCreds.apiKey, baseUrl: liveCreds.baseUrl, model: liveCreds.model, tasks });
    const ccRuns = await runM5ClaudeCodeAgent(FIXTURES, join(workDir, 'cc'), { cli: claudeCli!, timeoutMs: 180_000, tasks });
    const report = buildM5CompareReport({
      pacode: pacodeRuns.map((r) => ({ taskId: r.taskId, passed: r.passed, durationMs: r.durationMs, message: r.message })),
      cc: ccRuns.map((r) => ({ taskId: r.taskId, passed: r.passed, durationMs: r.durationMs, message: r.message })),
      threshold: THRESHOLD, taskIds: tasks,
      note: `m5-hard head-to-head via ${liveCreds.source}; model=${liveCreds.model ?? 'default'}`,
      claudeVersion: claudeCli ? readClaudeVersion(claudeCli) : undefined,
    });
    writeM5CompareReport(join(FIXTURES, 'COMPARE.json'), report);
    expect(meetsThreshold(report.pacodePassRate, THRESHOLD)).toBe(true);
    expect(meetsThreshold(report.ccPassRate, THRESHOLD)).toBe(true);
  }, 900_000);
});
