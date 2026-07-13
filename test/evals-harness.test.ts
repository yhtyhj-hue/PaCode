/**
 * Eval harness 基础设施测试
 */
import { describe, it, expect } from 'vitest';
import { buildSuiteReport, meetsThreshold } from '../evals/lib/types.js';
import { runEvalCase, printSuiteSummary } from '../evals/lib/runner.js';

describe('eval harness lib', () => {
  it('buildSuiteReport aggregates pass rate', () => {
    const report = buildSuiteReport('gate', [
      {
        id: 'a',
        lane: 'gate',
        passed: true,
        score: 1,
        threshold: 1,
        durationMs: 1,
      },
      {
        id: 'b',
        lane: 'gate',
        passed: false,
        score: 0,
        threshold: 1,
        message: 'fail',
        durationMs: 2,
      },
    ]);
    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.passRate).toBe(0.5);
  });

  it('meetsThreshold compares score to threshold', () => {
    expect(meetsThreshold(0.9, 0.8)).toBe(true);
    expect(meetsThreshold(0.7, 0.8)).toBe(false);
  });

  it('runEvalCase captures failures', async () => {
    const result = await runEvalCase({
      id: 'throws',
      lane: 'gate',
      run: () => {
        throw new Error('boom');
      },
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('boom');
  });

  it('printSuiteSummary does not throw', () => {
    expect(() => printSuiteSummary('gate', 2, 3)).not.toThrow();
  });
});
