/**
 * Claude Code 风格输出 — 摘要与格式化
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatCompactToolSummary } from '../src/cli/tool-summary.js';
import { EnhancedRenderer } from '../src/cli/enhanced-renderer.js';
import { QueryProgressLine } from '../src/cli/query-progress.js';
import { formatStatusBarLeft } from '../src/cli/repl-ui.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('formatCompactToolSummary', () => {
  it('aggregates Read calls', () => {
    const tools = [
      { id: '1', name: 'Read', input: { path: 'a.ts' } },
      { id: '2', name: 'Read', input: { path: 'b.ts' } },
      { id: '3', name: 'Read', input: { path: 'c.ts' } },
    ];
    expect(formatCompactToolSummary(tools)).toBe('Read 3 files');
  });

  it('combines Read and Bash', () => {
    const tools = [
      { id: '1', name: 'Read', input: { path: 'a.ts' } },
      { id: '2', name: 'Bash', input: { command: 'git status' } },
      { id: '3', name: 'Bash', input: { command: 'npm test' } },
    ];
    expect(formatCompactToolSummary(tools)).toBe('Read 1 file · 2 commands');
  });
});

describe('EnhancedRenderer CC style', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  const r = new EnhancedRenderer();

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('renderCompactToolActivity matches CC one-liner', () => {
    r.renderCompactToolActivity([
      { id: '1', name: 'Read', input: { path: 'a.ts' } },
      { id: '2', name: 'Read', input: { path: 'b.ts' } },
    ]);
    const out = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('Read 2 files');
    expect(out).toContain('ctrl+o to expand');
  });

  it('renderToolResult summarizes Read/Bash/Grep/Glob and errors', () => {
    r.renderToolResult(
      { id: '1', name: 'Read', input: { path: 'a.ts' } },
      { content: [{ type: 'text', text: 'l1\nl2\nl3' }] }
    );
    r.renderToolResult(
      { id: '2', name: 'Glob', input: { pattern: '*.ts' } },
      { content: [{ type: 'text', text: 'a.ts\nb.ts' }] }
    );
    r.renderToolResult(
      { id: '3', name: 'Grep', input: { pattern: 'x' } },
      { content: [{ type: 'text', text: 'm1\nm2' }] }
    );
    r.renderToolResult(
      { id: '4', name: 'Bash', input: { command: 'echo' } },
      { content: [{ type: 'text', text: 'ok\nmore' }] }
    );
    r.renderToolResult(
      { id: '5', name: 'Bash', input: { command: 'x' } },
      {
        content: [
          {
            type: 'text',
            text: 'a'.repeat(100),
          },
        ],
      }
    );
    r.renderToolResult(
      { id: '6', name: 'Write', input: { path: 'a' } },
      { content: [{ type: 'text', text: 'saved' }], isError: true }
    );
    r.renderToolResult(
      { id: '7', name: 'Write', input: { path: 'a' } },
      { content: [{ type: 'text', text: '' }] }
    );
    r.renderToolUse({
      id: '8',
      name: 'Bash',
      input: { command: 'x'.repeat(80) },
    });
    const out = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('lines');
    expect(out).toContain('paths');
    expect(out).toContain('matches');
    expect(out).toContain('...');
  });

  it('renderMarkdown applies CC list bullets', () => {
    const md = r.renderMarkdown('**bold** *i* `code`\n- item');
    expect(md).toContain('●');
    expect(md).toContain('bold');
  });

  it('renderAccomplishingBlock shows task tree', () => {
    r.renderAccomplishingBlock(
      [
        { label: 'Git变更分析', status: 'running' },
        { label: '项目配置审查', status: 'pending' },
      ],
      { elapsedSec: 3, outputTokens: 120 }
    );
    const out = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('Git变更分析');
    expect(out).toContain('3s');
    expect(out).toContain('120 tokens');
    expect(out).toContain('└');
    expect(out).toContain('□');
  });

  it('renderAccomplishingBlock doneHeader and error status', () => {
    r.renderAccomplishingBlock(
      [
        { label: 'ok', status: 'done' },
        { label: 'bad', status: 'error' },
        { label: 'p1', status: 'pending' },
        { label: 'p2', status: 'pending' },
        { label: 'p3', status: 'pending' },
        { label: 'p4', status: 'pending' },
      ],
      { elapsedSec: 2, outputTokens: 10, doneHeader: true, maxVisible: 5 }
    );
    r.renderAgentsStarting([]);
    r.renderAgentsStarting([{ label: 'a' }, { label: 'b' }], { elapsedSec: 2 });
    const out = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('Explore complete');
    expect(out).toContain('… +1 pending');
    expect(out).toContain('Running 2 explore subagents');
  });

  it('renderParallelAgents starts with one-line status, completes with filled boxes', () => {
    r.renderParallelAgents(
      [
        { label: 'Agent 核心回路', status: 'pending', toolCalls: 0 },
        { label: '工具层实现', status: 'running', toolCalls: 1 },
      ],
      { elapsedSec: 1 }
    );
    let out = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('Running 2 explore subagents');
    expect(out).not.toContain('Accomplishing');

    writeSpy.mockClear();
    r.renderParallelAgents(
      [
        { label: 'Agent 核心回路', status: 'done', toolCalls: 2 },
        { label: '工具层实现', status: 'done', toolCalls: 1 },
      ],
      { elapsedSec: 4 }
    );
    out = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('Explore complete');
    expect(out).toContain('Agent 核心回路');
  });
});

describe('QueryProgressLine CC style', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('uses Accomplishing instead of thinking', () => {
    const line = new QueryProgressLine();
    line.startThinking();
    expect(writeSpy.mock.calls.some((c) => String(c[0]).includes('Accomplishing'))).toBe(true);
    line.stop();
  });
});

describe('repl-ui status bar', () => {
  it('uses >> prefix like Claude Code', () => {
    const bar = formatStatusBarLeft(PermissionMode.ACCEPT_EDITS);
    expect(bar).toContain('>>');
    expect(bar).toContain('accept edits on');
  });
});
