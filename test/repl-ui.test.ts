/**
 * REPL UI formatting tests
 */

import { describe, it, expect } from 'vitest';
import {
  formatModeStatusLabel,
  formatTokenDisplay,
  formatStatusBar,
  formatInputPrompt,
  formatUserMessage,
  formatInputAreaBlock,
  formatInputAreaHeader,
  formatInputFooter,
  visibleWidth,
} from '../src/cli/repl-ui.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('repl-ui', () => {
  it('formats mode labels like Claude Code', () => {
    expect(formatModeStatusLabel(PermissionMode.ACCEPT_EDITS)).toBe('accept edits on');
    expect(formatModeStatusLabel(PermissionMode.DEFAULT)).toBe('normal mode');
    expect(formatModeStatusLabel(PermissionMode.PLAN)).toBe('plan mode');
  });

  it('formats token counts with k suffix', () => {
    expect(formatTokenDisplay(553600)).toBe('553.6k tokens');
    expect(formatTokenDisplay(42)).toBe('42 tokens');
  });

  it('builds status bar with left mode and right tokens', () => {
    const bar = formatStatusBar(PermissionMode.ACCEPT_EDITS, 553600, 120);
    expect(bar).toContain('accept edits on');
    expect(bar).toContain('/clear to save');
    expect(bar).toContain('553.6k tokens');
    expect(visibleWidth(bar)).toBe(120);
  });

  it('formatInputAreaBlock borders match requested width', () => {
    const block = formatInputAreaBlock(PermissionMode.DEFAULT, 0, '', 80);
    const lines = block.split('\n');
    expect(visibleWidth(lines[0]!)).toBe(80);
    expect(visibleWidth(lines[2]!)).toBe(80);
    expect(visibleWidth(lines[3]!)).toBe(80);
  });

  it('uses simple > prompt', () => {
    expect(formatInputPrompt()).toContain('>');
  });

  it('formats user turn without input box borders', () => {
    const line = formatUserMessage('hello');
    expect(line).toContain('hello');
    expect(line.replace(/\x1b\[[0-9;]*m/g, '')).toContain('> hello');
    expect(line).not.toContain('─');
  });

  it('builds input area block in Claude Code order', () => {
    const block = formatInputAreaBlock(PermissionMode.DEFAULT, 0);
    const lines = block.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('>');
    expect(lines[3]).toContain('0 tokens');
  });

  it('builds legacy input area header with borders and status bar', () => {
    const header = formatInputAreaHeader(PermissionMode.DEFAULT, 0);
    expect(header).toContain('─');
    expect(header).toContain('normal mode');
    expect(header).toContain('0 tokens');
    expect(header.split('\n').length).toBe(3);
  });

  it('keeps formatInputFooter as alias', () => {
    expect(formatInputFooter(PermissionMode.DEFAULT, 0)).toBe(
      formatInputAreaHeader(PermissionMode.DEFAULT, 0)
    );
  });

  it('counts CJK characters as width 2 for cursor placement', () => {
    expect(visibleWidth('对话')).toBe(4);
    expect(visibleWidth('ab')).toBe(2);
    expect(visibleWidth('对a')).toBe(3);
  });
});
