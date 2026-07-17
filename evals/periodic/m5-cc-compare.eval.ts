/**
 * Periodic eval: M5 PaCode live vs Claude Code CLI（同 fixture / verify）
 *
 * - 无 claude CLI 或无 API 凭证 → skip
 * - 写 COMPARE.json；双方均需 passRate ≥ 0.5；速度用套件墙钟
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const FIXTURES = join(process.cwd(), 'evals/fixtures/m5');
const THRESHOLD = 0.5;
const liveCreds = resolveM5LiveCredentials();
const claudeCli = resolveClaudeCli();
const canCompare = Boolean(liveCreds.apiKey && claudeCli);

describe('eval:periodic:m5-cc-compare (wiring)', () => {
  it('resolveClaudeCli returns path or null without throwing', () => {
    const cli = resolveClaudeCli();
    expect(cli === null || cli.includes('claude')).toBe(true);
  });
});

describe.skipIf(!canCompare)('eval:periodic:m5-cc-compare (live head-to-head)', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'm5-cmp-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it(
    'PaCode live and Claude Code both meet once-success threshold on same fixtures',
    async () => {
      const pacodeRoot = join(workDir, 'pacode');
      const ccRoot = join(workDir, 'cc');

      const timed = async <T>(fn: () => Promise<T>): Promise<{ value: T; wallMs: number }> => {
        const t0 = Date.now();
        const value = await fn();
        return { value, wallMs: Date.now() - t0 };
      };

      // PaCode 任务并行（墙钟）；CC 保持串行（贴近真实 CLI 一次一任务）
      const pacodePack = await timed(() =>
        runM5LiveAgent(FIXTURES, pacodeRoot, {
          timeoutMs: 180_000,
          apiKey: liveCreds.apiKey,
          baseUrl: liveCreds.baseUrl,
          model: liveCreds.model,
        })
      );
      const ccPack = await timed(() =>
        runM5ClaudeCodeAgent(FIXTURES, ccRoot, {
          cli: claudeCli!,
          timeoutMs: 180_000,
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
        note: `head-to-head via ${liveCreds.source}; pacode model=${liveCreds.model ?? 'default'}; speed=wall`,
        claudeVersion: claudeCli ? readClaudeVersion(claudeCli) : undefined,
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
    },
    900_000
  );
});
