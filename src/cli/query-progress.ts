/**
 * Query 进度行 — CC 风格 * Accomplishing… (Ns)
 */

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const ORANGE = '\x1b[38;5;208m';

export class QueryProgressLine {
  private startedAt = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private phase: 'thinking' | 'prefetch' | 'idle' = 'thinking';
  private prefetchLabel = '';
  /** 多行 agent 块已输出后禁止 \\r 刷新，避免覆盖上方内容 */
  private suspended = false;

  startThinking(): void {
    this.startedAt = Date.now();
    this.phase = 'thinking';
    this.prefetchLabel = '';
    this.suspended = false;
    this.startTimer();
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
    const label =
      this.phase === 'prefetch' && this.prefetchLabel
        ? this.prefetchLabel
        : 'Accomplishing…';
    process.stdout.write(`\r${ORANGE}*${RESET} ${ORANGE}${label}${RESET}${DIM} (${secs}s)${RESET}  `);
  }
}
