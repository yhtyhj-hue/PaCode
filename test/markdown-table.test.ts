/**
 * Markdown 表格终端排版测试
 */

import { describe, it, expect } from 'vitest';
import {
  formatTableAsCards,
  formatAlignedTable,
  rewriteTablesInText,
  isTableRow,
  isTableSeparator,
  splitTableCells,
  wrapVisible,
} from '../src/cli/markdown-table.js';
import { visibleWidth } from '../src/cli/repl-ui.js';
import { StreamingMarkdownWriter } from '../src/cli/streaming-markdown.js';

describe('markdown-table', () => {
  it('detects table rows and separators', () => {
    expect(isTableRow('| 能力 | 状态 |')).toBe(true);
    expect(isTableSeparator('|---|---|')).toBe(true);
    expect(isTableSeparator('| :--- | ---: |')).toBe(true);
    expect(isTableRow('普通文字')).toBe(false);
  });

  it('splits cells', () => {
    expect(splitTableCells('| 错误上报 | ❌ 无 OTEL |')).toEqual(['错误上报', '❌ 无 OTEL']);
  });

  it('wrapVisible respects visible width for CJK', () => {
    const lines = wrapVisible('错误上报与可观测性以及更多说明文字', 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(10);
    }
  });

  it('formats 3-col as cards without box borders', () => {
    const out = formatTableAsCards(
      [
        ['类别', '代表文件', '评估'],
        ['真实代码改动', 'src/agent/engine.ts', '安全加固'],
        ['文档同步', 'ARCHITECTURE.md', '与代码一致'],
      ],
      { width: 80 }
    );
    expect(out).toContain('真实代码改动');
    expect(out).toContain('代表文件:');
    expect(out).toContain('评估:');
    expect(out).toContain('└');
    expect(out).toContain('├');
    expect(out).not.toContain('┌');
    expect(out).not.toContain('|---|');
  });

  it('formatAlignedTable also uses cards (no misaligned pipes)', () => {
    const out = formatAlignedTable([
      ['A', 'B', 'C'],
      ['中文类别', '很长很长的文件路径/src/x.ts', '评估说明很长很长'],
    ]);
    expect(out).not.toContain('│');
    expect(out).toContain('中文类别');
  });

  it('rewrites Unicode box-drawing tables into cards', () => {
    const raw = [
      '变更性质分类：',
      '',
      '┌────────┬──────────┬──────┐',
      '│ 类别   │ 代表文件 │ 评估 │',
      '├────────┼──────────┼──────┤',
      '│ 真实代码改动 │ engine.ts │ 安全加固 │',
      '│ 污染文件 │ coverage/ │ 应 ignore │',
      '└────────┴──────────┴──────┘',
      '',
      '完。',
    ].join('\n');

    const out = rewriteTablesInText(raw, 100);
    expect(out).toContain('真实代码改动');
    expect(out).toContain('代表文件:');
    expect(out).not.toContain('┌');
    expect(out).not.toContain('│');
    expect(out).toContain('完。');
  });

  it('detects Unicode data rows as table rows', () => {
    expect(isTableRow('│ 类别 │ 评估 │')).toBe(true);
    expect(isTableRow('┌──┬──┐')).toBe(true);
    expect(isTableSeparator('├──┼──┤')).toBe(true);
  });
});

describe('StreamingMarkdownWriter tables', () => {
  it('buffers 3-col table until complete then emits cards', () => {
    const writer = new StreamingMarkdownWriter();
    let out = '';
    out += writer.append('| 类别 | 代表文件 | 评估 |\n');
    expect(out).toBe('');
    out += writer.append('|---|---|---|\n');
    out += writer.append('| 真实代码改动 | engine.ts | 安全加固 |\n');
    expect(out).toBe('');
    out += writer.append('\n结论\n');
    expect(out).toContain('真实代码改动');
    expect(out).toContain('代表文件:');
    expect(out).not.toContain('┌');
    expect(out).toContain('结论');
  });

  it('flush forces remaining table out as cards', () => {
    const writer = new StreamingMarkdownWriter();
    writer.append('| a | b | c |\n| 一 | 二 | 三 |\n');
    const flushed = writer.flush();
    expect(flushed).toContain('一');
    expect(flushed).toContain('└');
    expect(flushed).not.toContain('│');
  });
});
