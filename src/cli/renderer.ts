/**
 * CLI Renderer
 *
 * Terminal UI rendering utilities.
 */

export class Renderer {
  private width: number;

  constructor(width = 80) {
    this.width = width;
  }

  box(content: string, options?: { width?: number; align?: 'left' | 'center' | 'right' }): string {
    const w = options?.width ?? this.width;
    const align = options?.align ?? 'left';
    const lines = content.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      const padded = this.pad(line, w, align);
      result.push(`│${padded}│`);
    }

    const border = '┌' + '─'.repeat(w) + '┐';
    const bottom = '└' + '─'.repeat(w) + '┘';

    return [border, ...result, bottom].join('\n');
  }

  private pad(text: string, width: number, align: 'left' | 'center' | 'right'): string {
    const chars = this.stripAnsi(text);
    const padding = width - chars.length;

    if (padding <= 0) return text.slice(0, width);

    switch (align) {
      case 'center': {
        const left = Math.floor(padding / 2);
        return ' '.repeat(left) + text + ' '.repeat(padding - left);
      }
      case 'right':
        return ' '.repeat(padding) + text;
      default:
        return text + ' '.repeat(padding);
    }
  }

  private stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  progressBar(current: number, total: number, barWidth = 40): string {
    const ratio = Math.min(current / total, 1);
    const filled = Math.round(ratio * barWidth);
    const empty = barWidth - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const pct = Math.round(ratio * 100);
    return `[${bar}] ${pct}%`;
  }

  formatToolUse(name: string, args: Record<string, unknown>): string {
    const argsStr = Object.entries(args)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    return `🔧 [${name}] ${argsStr}`;
  }

  formatError(message: string): string {
    return `❌ ${message}`;
  }

  formatSuccess(message: string): string {
    return `✅ ${message}`;
  }

  formatInfo(message: string): string {
    return `ℹ️ ${message}`;
  }

  spinner(frame = 0): string {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return frames[frame % frames.length] ?? '⠋';
  }

  setWidth(width: number): void {
    this.width = width;
  }
}

export const renderer = new Renderer();
