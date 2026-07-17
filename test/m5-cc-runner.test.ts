/**
 * M5 × Claude Code compare harness — unit (无网络)
 */

import { describe, it, expect } from 'vitest';
import {
  buildClaudePrintArgs,
  buildM5CompareReport,
  resolveClaudeCli,
} from '../evals/lib/m5-cc-runner.js';

describe('m5-cc-runner', () => {
  it('buildClaudePrintArgs puts prompt last and skips stdin wait flags', () => {
    const args = buildClaudePrintArgs('fix the bug', ['Read', 'Edit']);
    expect(args[0]).toBe('-p');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--allowed-tools=Read,Edit');
    expect(args.at(-1)).toBe('fix the bug');
  });

  it('resolveClaudeCli respects PACODE_CLAUDE_CLI override', () => {
    expect(resolveClaudeCli({ PACODE_CLAUDE_CLI: '/opt/bin/claude' })).toBe(
      '/opt/bin/claude'
    );
  });

  it('buildM5CompareReport computes both pass rates', () => {
    const report = buildM5CompareReport({
      pacode: [
        { taskId: 'fix-bug', passed: true, durationMs: 10 },
        { taskId: 'add-test', passed: true, durationMs: 20 },
        { taskId: 'small-refactor', passed: false, durationMs: 30 },
      ],
      cc: [
        { taskId: 'fix-bug', passed: true, durationMs: 11 },
        { taskId: 'add-test', passed: false, durationMs: 21 },
        { taskId: 'small-refactor', passed: true, durationMs: 31 },
      ],
      note: 'unit',
      claudeVersion: '2.1.207',
    });
    expect(report.pacodePassRate).toBeCloseTo(2 / 3);
    expect(report.ccPassRate).toBeCloseTo(2 / 3);
    expect(report.tasks).toHaveLength(3);
    expect(report.claudeVersion).toBe('2.1.207');
  });
});
