/**
 * 工具执行中的 Running… 行（CC: Bash Running… (4s · timeout 1m)）
 */

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const ORANGE = '\x1b[38;5;208m';

const LONG_RUNNING_TOOLS = new Set(['Bash', 'WebFetch', 'Task']);

export function isLongRunningTool(name: string): boolean {
  return LONG_RUNNING_TOOLS.has(name);
}

export function formatTimeoutLabel(timeoutMs: number): string {
  if (timeoutMs >= 60_000) {
    const m = Math.round(timeoutMs / 60_000);
    return `${m}m`;
  }
  return `${Math.round(timeoutMs / 1000)}s`;
}

/** 纯文本一行，便于测试 */
export function formatRunningLine(elapsedSec: number, timeoutLabel: string): string {
  return `  ${ORANGE}Running…${RESET}${DIM} (${elapsedSec}s · timeout ${timeoutLabel})${RESET}`;
}

/**
 * tool_use 后启动，tool_result 前清除
 * 占用 1 行；可选 hint 第 2 行
 */
export class ToolRunningLine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private timeoutLabel = '1m';
  private linesPrinted = 0;
  private showBackgroundHint = false;

  start(options: { timeoutMs?: number; backgroundHint?: boolean } = {}): void {
    this.stop();
    this.startedAt = Date.now();
    this.timeoutLabel = formatTimeoutLabel(options.timeoutMs ?? 60_000);
    this.showBackgroundHint = options.backgroundHint ?? false;
    this.render();
    this.timer = setInterval(() => this.render(), 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.erase();
  }

  private erase(): void {
    if (this.linesPrinted <= 0) return;
    process.stdout.write(`\x1b[${this.linesPrinted}A\x1b[J`);
    this.linesPrinted = 0;
  }

  private render(): void {
    const elapsedSec = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
    const lines = [formatRunningLine(elapsedSec, this.timeoutLabel)];
    if (this.showBackgroundHint) {
      lines.push(`${DIM}  (use run_in_background for long jobs)${RESET}`);
    }

    if (this.linesPrinted > 0) {
      process.stdout.write(`\x1b[${this.linesPrinted}A\x1b[J`);
    }
    process.stdout.write(lines.join('\n') + '\n');
    this.linesPrinted = lines.length;
  }
}
