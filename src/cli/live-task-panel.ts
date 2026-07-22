/**
 * CC 风格实时任务树 — TodoWrite 驱动，可原地刷新
 *
 * 布局：
 *   * <title>… (Ns · ↓ tokens)
 *     └ ■ done / in_progress
 *     └ □ pending
 *     … +N pending
 */

import type { TodoItem } from '../context/todo-store.js';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const ORANGE = '\x1b[38;5;208m';
const RED = '\x1b[31m';

export type TaskPanelStatus = 'pending' | 'in_progress' | 'completed' | 'done' | 'running' | 'error';

export interface TaskPanelItem {
  label: string;
  status: TaskPanelStatus | string;
}

export interface LiveTaskPanelOptions {
  title?: string;
  elapsedSec?: number;
  outputTokens?: number;
  maxVisible?: number;
}

/** 将 TodoStore 条目映射为面板项 */
export function todosToPanelItems(todos: TodoItem[]): TaskPanelItem[] {
  return todos.map((t) => ({ label: t.content, status: t.status }));
}

/** 标题：优先进行中任务，否则 Accomplishing… */
export function resolveTaskPanelTitle(items: TaskPanelItem[], fallback = 'Accomplishing…'): string {
  const active = items.find((t) => t.status === 'in_progress' || t.status === 'running');
  if (active?.label) {
    const label = active.label.trim();
    return label.length > 40 ? `${label.slice(0, 37)}…` : `${label}…`;
  }
  return fallback;
}

function statusBox(status: string): { box: string; labelStyle: string } {
  if (status === 'completed' || status === 'done') {
    return { box: `${GREEN}■${RESET}`, labelStyle: DIM };
  }
  if (status === 'in_progress' || status === 'running') {
    return { box: `${ORANGE}■${RESET}`, labelStyle: ORANGE };
  }
  if (status === 'error') {
    return { box: `${RED}■${RESET}`, labelStyle: RED };
  }
  return { box: `${DIM}□${RESET}`, labelStyle: DIM };
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** 纯函数：生成任务树文本（无 ANSI 清屏），供测试与渲染共用 */
export function formatTaskPanelBlock(
  items: TaskPanelItem[],
  options: LiveTaskPanelOptions = {}
): string {
  if (!items.length) return '';

  const elapsed = Math.max(1, options.elapsedSec ?? 1);
  const tokens = options.outputTokens ?? 0;
  const tokenPart = tokens > 0 ? ` · ↓ ${formatTokenCount(tokens)} tokens` : '';
  const title = options.title ?? resolveTaskPanelTitle(items);
  const max = options.maxVisible ?? 5;

  const lines: string[] = [];
  lines.push(`${ORANGE}*${RESET} ${ORANGE}${title}${RESET}${DIM} (${formatElapsed(elapsed)}${tokenPart})${RESET}`);

  const visible = items.slice(0, max);
  for (const task of visible) {
    const { box, labelStyle } = statusBox(task.status);
    lines.push(`  ${DIM}└${RESET} ${box} ${labelStyle}${task.label}${RESET}`);
  }

  const pending = items.length - max;
  if (pending > 0) {
    lines.push(`${DIM}  … +${pending} pending${RESET}`);
  }

  return lines.join('\n') + '\n';
}

function formatTokenCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

/**
 * 终端实时面板：其它输出后 invalidate，避免 cursor-up 盖住工具行
 */
export class LiveTaskPanel {
  private items: TaskPanelItem[] = [];
  private linesPrinted = 0;
  private canRedrawInPlace = false;
  private outputTokens = 0;
  private startedAt = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private maxVisible = 5;

  get hasTasks(): boolean {
    return this.items.length > 0;
  }

  /** 其它 stdout 写入后调用，下次改为追加新块 */
  invalidate(): void {
    this.canRedrawInPlace = false;
  }

  setOutputTokens(n: number): void {
    this.outputTokens = n;
    if (this.hasTasks && this.canRedrawInPlace) this.redraw();
  }

  /** 同步任务列表并渲染 */
  sync(items: TaskPanelItem[], options: { resetTimer?: boolean } = {}): void {
    this.items = items.slice();
    if (options.resetTimer || this.timer === null) {
      this.startedAt = Date.now();
    }
    if (!this.items.length) {
      this.clear();
      return;
    }
    this.ensureTimer();
    this.redraw();
  }

  stop(): void {
    this.stopTimer();
    this.canRedrawInPlace = false;
  }

  clear(): void {
    this.stopTimer();
    this.items = [];
    this.erasePrinted();
    this.linesPrinted = 0;
    this.canRedrawInPlace = false;
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.hasTasks && this.canRedrawInPlace) this.redraw();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private erasePrinted(): void {
    if (this.linesPrinted <= 0 || !this.canRedrawInPlace) return;
    process.stdout.write(`\x1b[${this.linesPrinted}A\x1b[J`);
    this.linesPrinted = 0;
  }

  private redraw(): void {
    if (!this.items.length) return;

    const elapsedSec = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
    const block = formatTaskPanelBlock(this.items, {
      elapsedSec,
      outputTokens: this.outputTokens,
      maxVisible: this.maxVisible,
    });
    const lineCount = block.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')).length;

    if (this.canRedrawInPlace && this.linesPrinted > 0) {
      process.stdout.write(`\x1b[${this.linesPrinted}A\x1b[J`);
    } else if (this.linesPrinted === 0 || !this.canRedrawInPlace) {
      process.stdout.write('\n');
    }

    process.stdout.write(block);
    this.linesPrinted = lineCount;
    this.canRedrawInPlace = true;
  }
}
