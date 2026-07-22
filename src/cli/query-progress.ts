/**
 * Query 进度行 — CC 风格 * Accomplishing… (Ns · ↓ tokens)
 */

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const ORANGE = '\x1b[38;5;208m';

function formatTokenCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

export class QueryProgressLine {
  private startedAt = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private phase: 'thinking' | 'prefetch' | 'tool' | 'idle' = 'thinking';
  private prefetchLabel = '';
  private toolLabel = '';
  private outputTokens = 0;
  /** 本轮工具时间线（供 message_stop 后摘要） */
  private timeline: string[] = [];
  /** 多行 agent 块已输出后禁止 \\r 刷新，避免覆盖上方内容 */
  private suspended = false;

  startThinking(): void {
    this.startedAt = Date.now();
    this.phase = 'thinking';
    this.prefetchLabel = '';
    this.toolLabel = '';
    this.outputTokens = 0;
    this.timeline = [];
    this.suspended = false;
    this.startTimer();
  }

  /** 流式累计输出 token，进度行显示 ↓ N tokens */
  setOutputTokens(n: number): void {
    this.outputTokens = n;
    if (!this.suspended) this.render();
  }

  /** agent 块等多行 UI 渲染后调用，停止单行进度覆盖 */
  suspend(): void {
    this.suspended = true;
    this.stopTimer();
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
  }

  setPrefetchPhase(label: string): void {
    if (this.suspended) return;
    this.phase = 'prefetch';
    this.prefetchLabel = label;
    this.render();
  }

  /** 工具执行阶段标签（Reading… / Bash…） */
  setToolPhase(label: string): void {
    if (this.suspended) return;
    this.phase = 'tool';
    this.toolLabel = label;
    if (label && !this.timeline.includes(label)) {
      this.timeline.push(label);
      if (this.timeline.length > 12) this.timeline.shift();
    }
    this.render();
  }

  /** 本轮工具时间线摘要（不含 Ink；纯文本一行） */
  formatTimelineSummary(): string {
    if (this.timeline.length === 0) return '';
    return `Tools: ${this.timeline.join(' → ')}`;
  }

  stop(): number {
    this.stopTimer();
    const elapsedMs = Date.now() - this.startedAt;
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
    return elapsedMs;
  }

  /** CC 不在完成后单独打印 Thought for Ns，进度行清除即可 */
  renderThoughtSummary(_elapsedMs: number): void {
    /* no-op — Accomplishing 行已在 stop() 时清除 */
  }

  elapsedSeconds(): number {
    return Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
  }

  private startTimer(): void {
    this.stopTimer();
    this.render();
    this.timer = setInterval(() => this.render(), 400);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private render(): void {
    if (this.suspended) return;
    const secs = this.elapsedSeconds();
    let label = 'Accomplishing…';
    if (this.phase === 'prefetch' && this.prefetchLabel) {
      label = this.prefetchLabel;
    } else if (this.phase === 'tool' && this.toolLabel) {
      label = this.toolLabel;
    }
    const tokenPart =
      this.outputTokens > 0 ? ` · ↓ ${formatTokenCount(this.outputTokens)} tokens` : '';
    process.stdout.write(
      `\r${ORANGE}*${RESET} ${ORANGE}${label}${RESET}${DIM} (${secs}s${tokenPart})${RESET}  `
    );
  }
}
