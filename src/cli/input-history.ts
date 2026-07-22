/**
 * REPL 输入历史 — ↑ 调出上次输入，↓ 回到更新项 / 草稿
 */

const DEFAULT_MAX = 100;

export class InputHistory {
  private entries: string[] = [];
  private max: number;
  /** -1 = 正在编辑新行（非历史浏览） */
  private index = -1;
  /** 进入历史前缓存的当前草稿 */
  private draft = '';

  constructor(max = DEFAULT_MAX) {
    this.max = max;
  }

  /** 提交成功后推入（去重：与最近一条相同则跳过） */
  push(line: string): void {
    const t = line.trimEnd();
    if (!t) return;
    if (this.entries[this.entries.length - 1] === t) {
      this.resetBrowse();
      return;
    }
    this.entries.push(t);
    if (this.entries.length > this.max) {
      this.entries.shift();
    }
    this.resetBrowse();
  }

  resetBrowse(): void {
    this.index = -1;
    this.draft = '';
  }

  isBrowsing(): boolean {
    return this.index !== -1;
  }

  /**
   * ↑：更旧。首次从草稿进入。
   * 返回要填入输入框的文本；已到最旧则返回当前项（不变）。
   */
  up(currentBuffer: string): string {
    if (this.entries.length === 0) return currentBuffer;

    if (this.index === -1) {
      this.draft = currentBuffer;
      this.index = this.entries.length - 1;
      return this.entries[this.index]!;
    }

    if (this.index > 0) {
      this.index -= 1;
    }
    return this.entries[this.index]!;
  }

  /**
   * ↓：更新。到底后恢复草稿。
   */
  down(currentBuffer: string): string {
    if (this.index === -1) return currentBuffer;

    if (this.index < this.entries.length - 1) {
      this.index += 1;
      return this.entries[this.index]!;
    }

    // 离开历史 → 草稿
    this.index = -1;
    const d = this.draft;
    this.draft = '';
    return d;
  }

  size(): number {
    return this.entries.length;
  }

  /** 测试用 */
  snapshot(): string[] {
    return [...this.entries];
  }
}
