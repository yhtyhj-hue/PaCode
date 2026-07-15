/**
 * REPL line editor cursor math tests
 */

import { describe, it, expect } from 'vitest';
import { zoneClearCursorUp, INPUT_LINE_TO_STATUS_BAR } from '../src/cli/repl-line-editor.js';
import { formatInputPrompt, visibleWidth } from '../src/cli/repl-ui.js';

describe('zoneClearCursorUp', () => {
  it('returns totalClear-1 to avoid eating line above input zone', () => {
    expect(zoneClearCursorUp(4)).toBe(3);
    expect(zoneClearCursorUp(7)).toBe(6);
    expect(zoneClearCursorUp(1)).toBe(0);
  });
});

/** 与 ReplLineEditor.positionOnInputLine 相同的列计算 */
export function inputCursorColumn(input: string): number {
  return visibleWidth(formatInputPrompt()) + visibleWidth(input) + 1;
}

describe('inputCursorColumn', () => {
  it('places cursor after CJK text, not on last glyph', () => {
    expect(inputCursorColumn('对话')).toBe(7);
    expect(inputCursorColumn('')).toBe(3);
    expect(inputCursorColumn('hello')).toBe(8);
  });
});

describe('INPUT_LINE_TO_STATUS_BAR', () => {
  it('matches input block layout', () => {
    expect(INPUT_LINE_TO_STATUS_BAR).toBe(2);
  });
});
