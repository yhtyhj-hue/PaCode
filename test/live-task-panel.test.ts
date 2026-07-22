/**
 * Live task panel + Running line — CC 风格交互
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatTaskPanelBlock,
  resolveTaskPanelTitle,
  todosToPanelItems,
  LiveTaskPanel,
} from '../src/cli/live-task-panel.js';
import {
  formatRunningLine,
  formatTimeoutLabel,
  isLongRunningTool,
  ToolRunningLine,
} from '../src/cli/tool-running-line.js';
import { getTodoStore, resetTodoStore } from '../src/context/todo-store.js';
import { registerTodoWriteTool } from '../src/tools/todowrite.js';
import { EnhancedRenderer } from '../src/cli/enhanced-renderer.js';
import { QueryProgressLine } from '../src/cli/query-progress.js';

describe('formatTaskPanelBlock', () => {
  it('shows filled ■ for in_progress/completed and □ for pending', () => {
    const out = formatTaskPanelBlock(
      [
        { label: '扫描覆盖率报告与阈值基线', status: 'completed' },
        { label: '跑 npm test', status: 'in_progress' },
        { label: '审计 src 模块', status: 'pending' },
      ],
      { elapsedSec: 64, outputTokens: 1900, maxVisible: 5 }
    );
    expect(out).toContain('1m 4s');
    expect(out).toContain('1.9k tokens');
    expect(out).toContain('■');
    expect(out).toContain('□');
    expect(out).toContain('跑 npm test');
  });

  it('truncates with +N pending', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      label: `step ${i}`,
      status: 'pending' as const,
    }));
    const out = formatTaskPanelBlock(items, { maxVisible: 5, elapsedSec: 2 });
    expect(out).toContain('… +2 pending');
  });
});

describe('resolveTaskPanelTitle', () => {
  it('truncates long in_progress title', () => {
    const long = '这是一个非常非常非常非常非常非常非常长的任务标题用于截断';
    expect(resolveTaskPanelTitle([{ label: long, status: 'in_progress' }])).toMatch(/…$/);
    expect(formatTaskPanelBlock([], { elapsedSec: 1 })).toBe('');
    expect(formatTaskPanelBlock([{ label: 'x', status: 'error' }], { elapsedSec: 90 })).toContain(
      '1m 30s'
    );
  });
});

describe('todosToPanelItems', () => {
  it('maps store items', () => {
    resetTodoStore();
    const store = getTodoStore();
    store.replaceAll('s1', [
      { content: 'a', status: 'pending' },
      { content: 'b', status: 'in_progress' },
    ]);
    const items = todosToPanelItems(store.list('s1'));
    expect(items).toHaveLength(2);
    expect(items[1].status).toBe('in_progress');
  });
});

describe('TodoWrite todos[] replace', () => {
  it('replaces full list in one call', async () => {
    resetTodoStore();
    const tools: Array<{ name: string; execute: Function }> = [];
    registerTodoWriteTool({
      register: (t) => {
        tools.push(t as never);
      },
    });
    const tool = tools[0];
    const sessionState = { sessionId: 'batch-todos' };
    const r = await tool.execute(
      {
        todos: [
          { content: '扫描覆盖率', status: 'completed' },
          { content: '跑测试', status: 'in_progress' },
          { content: '审计模块', status: 'pending' },
        ],
      },
      { workingDirectory: process.cwd(), sessionState, hooks: {} }
    );
    expect(r.isError).toBeFalsy();
    const list = getTodoStore().list('batch-todos');
    expect(list).toHaveLength(3);
    expect(list[1].status).toBe('in_progress');
  });
});

describe('ToolRunningLine helpers', () => {
  it('detects long-running tools', () => {
    expect(isLongRunningTool('Bash')).toBe(true);
    expect(isLongRunningTool('Read')).toBe(false);
  });

  it('formats timeout and running line', () => {
    expect(formatTimeoutLabel(60_000)).toBe('1m');
    expect(formatTimeoutLabel(5 * 60_000)).toBe('5m');
    expect(formatTimeoutLabel(15_000)).toBe('15s');
    const line = formatRunningLine(4, '5m');
    expect(line).toContain('Running…');
    expect(line).toContain('4s');
    expect(line).toContain('timeout 5m');
  });

  it('ToolRunningLine start/stop with hint', () => {
    vi.useFakeTimers();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const running = new ToolRunningLine();
    running.start({ timeoutMs: 120_000, backgroundHint: true });
    vi.advanceTimersByTime(1000);
    running.stop();
    writeSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe('EnhancedRenderer status mapping', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  const r = new EnhancedRenderer();

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<
      typeof vi.spyOn
    >;
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('maps in_progress to filled box and pending to hollow', () => {
    r.renderAccomplishingBlock(
      [
        { label: 'done step', status: 'completed' },
        { label: 'active step', status: 'in_progress' },
        { label: 'wait step', status: 'pending' },
      ],
      { elapsedSec: 3, outputTokens: 120 }
    );
    const out = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('active step');
    expect(out).toContain('■');
    expect(out).toContain('□');
  });
});

describe('QueryProgressLine tokens', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<
      typeof vi.spyOn
    >;
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('includes ↓ tokens when set', () => {
    const line = new QueryProgressLine();
    line.startThinking();
    line.setOutputTokens(1900);
    const out = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('tokens');
    line.stop();
  });
});

describe('LiveTaskPanel redraw', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<
      typeof vi.spyOn
    >;
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('sync writes task tree', () => {
    const panel = new LiveTaskPanel();
    panel.sync([
      { label: 'A', status: 'completed' },
      { label: 'B', status: 'pending' },
    ]);
    const out = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('A');
    expect(out).toContain('B');
    panel.stop();
  });

  it('clear and invalidate', () => {
    const panel = new LiveTaskPanel();
    panel.sync([{ label: 'A', status: 'pending' }]);
    panel.invalidate();
    panel.setOutputTokens(50);
    panel.clear();
    expect(panel.hasTasks).toBe(false);
    panel.stop();
  });
});

describe('TodoWrite error paths', () => {
  it('covers create/update/list/delete error paths', async () => {
    resetTodoStore();
    const tools: Array<{ execute: (input: unknown, ctx: unknown) => Promise<{ isError?: boolean }> }> =
      [];
    registerTodoWriteTool({ register: (t) => tools.push(t as never) });
    const tool = tools[0];
    const ctx = {
      workingDirectory: process.cwd(),
      sessionState: { sessionId: 'err-todos' },
      hooks: {},
    };
    expect((await tool.execute({ action: 'create' }, ctx)).isError).toBe(true);
    expect((await tool.execute({ action: 'update', id: 'x' }, ctx)).isError).toBe(true);
    expect((await tool.execute({ action: 'delete' }, ctx)).isError).toBe(true);
    expect((await tool.execute({}, ctx)).isError).toBe(true);
    const created = await tool.execute({ action: 'create', content: 'c' }, ctx);
    expect(created.isError).toBeFalsy();
    await tool.execute({ action: 'update', id: 'missing', status: 'completed' }, ctx);
    await tool.execute({ action: 'list' }, ctx);
  });
});
