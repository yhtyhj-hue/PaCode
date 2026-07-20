/**
 * Periodic: M5-hard PaCode vs Claude Code
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { M5_HARD_TASKS } from '../lib/m5-grader.js';
import { meetsThreshold } from '../lib/types.js';
import {
  resolveM5LiveCredentials,
  runM5LiveAgent,
  formatM5FailureSummary,
} from '../lib/m5-live-runner.js';
import {
  buildM5CompareReport,
  formatSpeedAssert,
  readClaudeVersion,
  resolveClaudeCli,
  runM5ClaudeCodeAgent,
  writeM5CompareReport,
} from '../lib/m5-cc-runner.js';

const FIXTURES = join(process.cwd(), 'evals/fixtures/m5-hard');
const THRESHOLD = 0.5;
const liveCreds = resolveM5LiveCredentials();
const claudeCli = resolveClaudeCli();
const canCompare = Boolean(liveCreds.apiKey && claudeCli);

describe.skipIf(!canCompare)('eval:periodic:m5-hard-cc-compare', () => {
  let workDir: string;
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'm5h-cmp-'));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });
  it('PaCode and Claude Code hard suite meet threshold and speed', async () => {
    const tasks = [...M5_HARD_TASKS];
    const timed = async <T>(fn: () => Promise<T>): Promise<{ value: T; wallMs: number }> => {
      const t0 = Date.now();
      const value = await fn();
      return { value, wallMs: Date.now() - t0 };
    };
    // PaCode 可并行；CC 串行（贴近 CLI）
    const pacodePack = await timed(() =>
      runM5LiveAgent(FIXTURES, join(workDir, 'pacode'), {
        timeoutMs: 180_000,
        apiKey: liveCreds.apiKey,
        baseUrl: liveCreds.baseUrl,
        model: liveCreds.model,
        tasks,
      })
    );
    const ccPack = await timed(() =>
      runM5ClaudeCodeAgent(FIXTURES, join(workDir, 'cc'), {
        cli: claudeCli!,
        timeoutMs: 180_000,
        tasks,
        concurrency: 1,
      })
    );
    const report = buildM5CompareReport({
      pacode: pacodePack.value.map((r) => ({
        taskId: r.taskId,
        passed: r.passed,
        durationMs: r.durationMs,
        message: r.message,
      })),
      cc: ccPack.value.map((r) => ({
        taskId: r.taskId,
        passed: r.passed,
        durationMs: r.durationMs,
        message: r.message,
      })),
      pacodeWallMs: pacodePack.wallMs,
      ccWallMs: ccPack.wallMs,
      threshold: THRESHOLD,
      taskIds: tasks,
      note: `m5-hard head-to-head via ${liveCreds.source}; model=${liveCreds.model ?? 'default'}; speed=wall`,
      claudeVersion: claudeCli ? readClaudeVersion(claudeCli) : undefined,
      ccVersion: claudeCli ? readClaudeVersion(claudeCli) : undefined,
      pacodeVersion: process.env['npm_package_version'] ?? '0.1.0',
      model: liveCreds.model,
    });
    writeM5CompareReport(join(FIXTURES, 'COMPARE.json'), report);
    expect(
      meetsThreshold(report.pacodePassRate, THRESHOLD),
      'PaCode: ' +
        formatM5FailureSummary(
          report.pacodePassRate,
          THRESHOLD,
          report.tasks.map((x) => ({
            id: x.id,
            passed: x.pacodePassed,
            message: x.pacodeMessage,
            durationMs: x.pacodeDurationMs,
          }))
        )
    ).toBe(true);
    expect(
      meetsThreshold(report.ccPassRate, THRESHOLD),
      'Claude Code: ' +
        formatM5FailureSummary(
          report.ccPassRate,
          THRESHOLD,
          report.tasks.map((x) => ({
            id: x.id,
            passed: x.ccPassed,
            message: x.ccMessage,
            durationMs: x.ccDurationMs,
          }))
        )
    ).toBe(true);
    expect(
      report.speedOk,
      formatSpeedAssert(
        report.pacodeWallMs ?? report.pacodeTotalMs,
        report.ccWallMs ?? report.ccTotalMs,
        report.speedRatio,
        report.speedMetric
      )
    ).toBe(true);
  }, 900_000);
});
