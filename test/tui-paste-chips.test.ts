/**
 * K7 Ink TUI — paste chips 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  renderPasteBuffer,
  countPasteRefs,
} from '../src/cli/tui/paste-chips.jsx';
import {
  shouldCollapsePaste,
  formatPastedTextRef,
} from '../src/cli/paste-chips.js';

describe('TUI paste chips', () => {
  it('long single-line text collapses via shouldCollapsePaste', () => {
    const long = 'x'.repeat(900);
    expect(shouldCollapsePaste(long)).toBe(true);
    expect(shouldCollapsePaste('short')).toBe(false);
    const multiline = 'a\nb\nc';
    expect(shouldCollapsePaste(multiline)).toBe(true);
  });

  it('formatPastedTextRef renders id and line count', () => {
    expect(formatPastedTextRef(1, 0)).toBe('[Pasted text #1]');
    expect(formatPastedTextRef(2, 5)).toBe('[Pasted text #2 +5 lines]');
  });

  it('renderPasteBuffer colorizes paste chips', () => {
    const pasted = new Map<number, { id: number; type: 'text'; content: string }>();
    pasted.set(1, { id: 1, type: 'text', content: 'hello world' });
    const buf = 'prefix [Pasted text #1] suffix';
    const { colorized, collapsed } = renderPasteBuffer(buf, pasted);
    expect(colorized).toContain('[Pasted text #1]');
    expect(collapsed).toBe(true);
  });

  it('countPasteRefs counts all paste token kinds', () => {
    expect(countPasteRefs('plain text')).toBe(0);
    expect(countPasteRefs('[Pasted text #1]')).toBe(1);
    expect(countPasteRefs('[Pasted text #1 +3 lines] [Image #2]')).toBe(2);
  });
});