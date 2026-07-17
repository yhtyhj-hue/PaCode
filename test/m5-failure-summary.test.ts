/**
 * M5 failure summary + task filter (gate)
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  formatM5FailureSummary,
  resolveM5TaskFilter,
} from '../evals/lib/m5-live-runner.js';

afterEach(() => {
  delete process.env['PACODE_M5_TASKS'];
});

describe('M5 diagnostics helpers', () => {
  it('formatM5FailureSummary lists failed tasks', () => {
    const text = formatM5FailureSummary(0.33, 0.5, [
      { id: 'a', passed: true, message: 'ok' },
      { id: 'b', passed: false, message: 'verify failed\nline2', durationMs: 12 },
    ]);
    expect(text).toContain('passRate=0.33');
    expect(text).toContain('failed=1/2');
    expect(text).toContain('b');
    expect(text).toContain('verify failed');
  });

  it('resolveM5TaskFilter respects PACODE_M5_TASKS', () => {
    expect(resolveM5TaskFilter(['fix-bug', 'add-test'])).toEqual(['fix-bug', 'add-test']);
    process.env['PACODE_M5_TASKS'] = 'add-test';
    expect(resolveM5TaskFilter(['fix-bug', 'add-test'])).toEqual(['add-test']);
  });
});
