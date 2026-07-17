/**
 * K7 Ink TUI unit tests (no full Ink mount — pure helpers + enable gate)
 */

import { describe, it, expect } from 'vitest';
import { shouldEnableTui } from '../src/cli/tui/enable.js';
import {
  appendDelta,
  formatToolLine,
  truncateLines,
  type TuiLine,
} from '../src/cli/tui/frames.js';
import { createInterruptGate } from '../src/cli/tui/app.js';

describe('K7 shouldEnableTui', () => {
  it('requires flag or PACODE_TUI=1 and TTY', () => {
    expect(shouldEnableTui({ tuiFlag: false, env: {}, isTTY: true })).toBe(false);
    expect(shouldEnableTui({ tuiFlag: true, env: {}, isTTY: false })).toBe(false);
    expect(shouldEnableTui({ tuiFlag: true, env: {}, isTTY: true })).toBe(true);
    expect(shouldEnableTui({ tuiFlag: false, env: { PACODE_TUI: '1' }, isTTY: true })).toBe(
      true
    );
  });
});

describe('K7 frames', () => {
  it('formats tool lines and appends assistant deltas', () => {
    expect(formatToolLine('Bash', 'npm test')).toBe('▸ Bash npm test');
    let lines: TuiLine[] = [];
    lines = appendDelta(lines, 'Hello');
    lines = appendDelta(lines, ' world');
    expect(lines).toEqual([{ kind: 'assistant', text: 'Hello world' }]);
  });

  it('truncates long transcripts', () => {
    const many: TuiLine[] = Array.from({ length: 100 }, (_, i) => ({
      kind: 'system' as const,
      text: `line-${i}`,
    }));
    const out = truncateLines(many, 10);
    expect(out[0]?.kind).toBe('system');
    expect(out[0]?.text).toMatch(/earlier lines hidden/);
    expect(out).toHaveLength(11);
  });
});

describe('K7 interrupt gate', () => {
  it('trips and resets', () => {
    const g = createInterruptGate();
    expect(g.shouldAbort()).toBe(false);
    g.trip();
    expect(g.shouldAbort()).toBe(true);
    g.reset();
    expect(g.shouldAbort()).toBe(false);
  });
});
