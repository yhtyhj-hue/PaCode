/**
 * Paste chips — CC-style placeholders
 */

import { describe, it, expect } from 'vitest';
import {
  formatPastedTextRef,
  formatImageRef,
  getPastedTextRefNumLines,
  shouldCollapsePaste,
  expandPastedTextRefs,
  extractImagesAndStripRefs,
  colorizePasteChips,
  hasCollapsedTextPaste,
  PASTE_THRESHOLD,
} from '../src/cli/paste-chips.js';
import { ReplLineEditor } from '../src/cli/repl-line-editor.js';
import { PermissionMode } from '../src/pkg/types.js';
import { formatInputPrompt, visibleWidth } from '../src/cli/repl-ui.js';

describe('paste chips format', () => {
  it('formats text and image refs like CC', () => {
    expect(formatPastedTextRef(1, 0)).toBe('[Pasted text #1]');
    expect(formatPastedTextRef(2, 5)).toBe('[Pasted text #2 +5 lines]');
    expect(formatImageRef(3)).toBe('[Image #3]');
    expect(getPastedTextRefNumLines('a\nb\nc')).toBe(2);
  });

  it('collapses multiline or long paste', () => {
    expect(shouldCollapsePaste('one line')).toBe(false);
    expect(shouldCollapsePaste('a\nb')).toBe(true);
    expect(shouldCollapsePaste('x'.repeat(PASTE_THRESHOLD))).toBe(true);
  });

  it('expands text chips and extracts images', () => {
    const pasted = new Map([
      [1, { id: 1, type: 'text' as const, content: 'hello\nworld' }],
      [2, { id: 2, type: 'image' as const, content: 'abc', mediaType: 'image/png' }],
    ]);
    const input = `see ${formatPastedTextRef(1, 1)} and ${formatImageRef(2)}`;
    const { text, images } = extractImagesAndStripRefs(input, pasted);
    expect(images).toHaveLength(1);
    expect(images[0]?.mediaType).toBe('image/png');
    expect(expandPastedTextRefs(text, pasted)).toContain('hello\nworld');
    expect(hasCollapsedTextPaste(input, pasted)).toBe(true);
    expect(colorizePasteChips(formatImageRef(3))).toContain('[Image #3]');
  });
});

describe('ReplLineEditor.handlePaste', () => {
  it('inserts collapsed chip and expands on second paste', () => {
    const ed = new ReplLineEditor();
    // 直接测 handlePaste，不走 TTY
    (ed as unknown as { buffer: string; cursor: number }).buffer = '';
    (ed as unknown as { cursor: number }).cursor = 0;
    ed.handlePaste('line1\nline2\nline3');
    const buf = (ed as unknown as { buffer: string }).buffer;
    expect(buf).toMatch(/\[Pasted text #1 \+2 lines\]/);

    ed.handlePaste('ignored');
    const expanded = (ed as unknown as { buffer: string }).buffer;
    expect(expanded).toBe('line1\nline2\nline3');
  });

  it('inserts image chip from png path when file exists', async () => {
    const { writeFileSync, unlinkSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'pacode-img-'));
    // minimal 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const path = join(dir, 'dot.png');
    writeFileSync(path, png);

    const ed = new ReplLineEditor();
    (ed as unknown as { buffer: string; cursor: number }).buffer = '';
    (ed as unknown as { cursor: number }).cursor = 0;
    ed.handlePaste(path);
    expect((ed as unknown as { buffer: string }).buffer).toBe('[Image #1]');

    unlinkSync(path);
  });
});

describe('formatInputPrompt CC style', () => {
  it('uses green chevron', () => {
    expect(formatInputPrompt()).toContain('❯');
    expect(visibleWidth(formatInputPrompt())).toBeGreaterThanOrEqual(2);
  });
});

// silence unused
void PermissionMode;
