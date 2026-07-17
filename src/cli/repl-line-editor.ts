/**
 * REPL 行编辑器 — 底部固定输入框，对话内容在上方滚动
 *
 * 输入 `/` 时在输入框上方显示 Claude Code 风格 slash 命令菜单。
 */

import readline from 'node:readline';
import { PermissionMode } from '../pkg/types.js';
import { formatInputAreaBlock, formatInputPrompt, visibleWidth } from './repl-ui.js';
import {
  filterSlashCommands,
  formatSlashMenu,
  completeSlashCommand,
  SlashMenuEntry,
} from './slash-menu.js';

export interface ReplLineOptions {
  mode: PermissionMode;
  tokens: number;
  isFirst?: boolean;
  slashCommands?: SlashMenuEntry[];
  /** 覆盖默认 `> ` 提示符（如 y/N 确认） */
  prompt?: string;
  /** Shift+Tab：循环权限模式，返回新 mode */
  onModeCycle?: () => PermissionMode;
}

export type VimEditorMode = 'insert' | 'normal';

/** 输入块行数：上横线 / 输入 / 下横线 / 状态栏 */
const INPUT_BLOCK_LINES = 4;

/** 从输入行移到状态栏需下移的行数 */
export const INPUT_LINE_TO_STATUS_BAR = 2;

/** 从输入行移到块末行（状态栏下一行）需下移的行数 */
const INPUT_LINE_TO_BLOCK_END = 3;

/** 向下清除 totalClear 行后，回到 zone 首行需上移的行数（供测试） */
export function zoneClearCursorUp(totalClear: number): number {
  return totalClear > 1 ? totalClear - 1 : 0;
}

export class ReplLineEditor {
  private buffer = '';
  private cursor = 0;
  private resolve: ((value: string | null) => void) | null = null;
  private keyHandler: ((str: string, key: readline.Key) => void) | null = null;
  private active = false;
  private paused = false;
  private currentOptions: ReplLineOptions | null = null;
  private menuVisibleLines = 0;
  /** 输入区已绘制时才向上清除，避免首次绘制误删上方内容 */
  private zoneDrawn = false;
  /** /vim 启用后：Esc → normal；i/a → insert */
  private vimEnabled = false;
  private vimMode: VimEditorMode = 'insert';

  constructor() {
    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin);
    }
  }

  setVimEnabled(enabled: boolean): void {
    this.vimEnabled = enabled;
    this.vimMode = 'insert';
  }

  isVimEnabled(): boolean {
    return this.vimEnabled;
  }

  getVimMode(): VimEditorMode {
    return this.vimMode;
  }

  pause(): void {
    this.paused = true;
    this.detachKeys();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }

  resume(): void {
    if (!process.stdin.isTTY) return;
    this.paused = false;
    if (this.active) {
      process.stdin.setRawMode(true);
      if (this.currentOptions) {
        this.fullRedraw();
        this.attachKeys();
      }
    }
  }

  close(): void {
    this.detachKeys();
    this.active = false;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }

  async readLine(options: ReplLineOptions): Promise<string | null> {
    if (!process.stdin.isTTY) {
      return this.readLineFallback();
    }

    this.buffer = '';
    this.cursor = 0;
    this.vimMode = 'insert';
    this.menuVisibleLines = 0;
    this.zoneDrawn = false;
    this.active = true;
    this.currentOptions = options;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    this.fullRedraw();

    return new Promise((resolve) => {
      this.resolve = resolve;
      this.attachKeys();
    });
  }

  private readLineFallback(): Promise<string | null> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('', (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  /** 清除菜单 + 输入块，并重绘 */
  private fullRedraw(): void {
    if (!this.currentOptions) return;

    if (this.zoneDrawn) {
      this.clearInputZone();
    } else if (!this.currentOptions.isFirst) {
      process.stdout.write('\n');
    }

    const menuLines = this.buffer.startsWith('/')
      ? formatSlashMenu(
          filterSlashCommands(this.buffer, this.currentOptions.slashCommands ?? [])
        )
      : [];

    for (const line of menuLines) {
      process.stdout.write(`${line}\n`);
    }

    process.stdout.write(
      `${formatInputAreaBlock(this.currentOptions.mode, this.currentOptions.tokens, this.buffer)}\n`
    );
    this.menuVisibleLines = menuLines.length;
    this.zoneDrawn = true;
    this.positionOnInputLine(this.buffer);
  }

  private positionOnInputLine(input: string): void {
    const cursor = Math.max(0, Math.min(this.cursor, input.length));
    readline.moveCursor(process.stdout, 0, -INPUT_LINE_TO_BLOCK_END);
    readline.cursorTo(
      process.stdout,
      visibleWidth(formatInputPrompt()) + visibleWidth(input.slice(0, cursor))
    );
  }

  /**
   * 从输入行清除菜单 + 输入块（用 readline API，避免手写 CSI 漏出 `[`）
   */
  private clearInputZone(): void {
    const totalClear = INPUT_BLOCK_LINES + this.menuVisibleLines;
    if (totalClear === 0) return;

    readline.moveCursor(process.stdout, 0, -(1 + this.menuVisibleLines));

    for (let i = 0; i < totalClear; i++) {
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
      if (i + 1 < totalClear) {
        readline.moveCursor(process.stdout, 0, 1);
      }
    }

    if (totalClear > 1) {
      readline.moveCursor(process.stdout, 0, -(totalClear - 1));
    }
  }

  private removeInputBlock(): void {
    if (this.zoneDrawn) {
      this.clearInputZone();
      process.stdout.write('\n');
    }
    this.menuVisibleLines = 0;
    this.zoneDrawn = false;
  }

  /** 取消等待中的输入（Ctrl+C 退出） */
  cancelReadLine(): void {
    if (this.active) this.finishSubmit(null);
  }

  /** 第二次 Ctrl+C：静默收起输入区并结束 readLine */
  cancelForExit(): void {
    if (!this.active) return;
    this.detachKeys();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      this.dismissInputBlock();
    }
    this.active = false;
    this.currentOptions = null;
    const done = this.resolve;
    this.resolve = null;
    done?.(null);
  }

  /** 第一次 Ctrl+C：在状态栏行显示弱提示，不重绘整块输入区 */
  showExitHint(hintLine: string): void {
    if (!this.active || !this.currentOptions || !process.stdout.isTTY) return;

    readline.moveCursor(process.stdout, 0, INPUT_LINE_TO_STATUS_BAR);
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(hintLine);

    readline.moveCursor(process.stdout, 0, -INPUT_LINE_TO_STATUS_BAR);
    this.positionOnInputLine(this.buffer);
  }

  isActive(): boolean {
    return this.active;
  }

  getBufferLength(): number {
    return this.buffer.length;
  }

  clearBuffer(): void {
    this.buffer = '';
    this.cursor = 0;
    if (this.active) this.fullRedraw();
  }

  /** 注入文本到当前输入（Voice STT）；返回是否写入成功 */
  injectText(text: string): boolean {
    if (!this.active || this.paused) return false;
    const t = text.trim();
    if (!t) return false;
    const before = this.buffer.slice(0, this.cursor);
    const after = this.buffer.slice(this.cursor);
    const sep = before.length > 0 && !before.endsWith(' ') ? ' ' : '';
    this.buffer = before + sep + t + after;
    this.cursor = (before + sep + t).length;
    this.fullRedraw();
    return true;
  }

  /** Ctrl+C 输出 ^C 提示后重绘底部输入区 */
  redrawAfterInterrupt(): void {
    if (this.active && this.currentOptions) {
      this.fullRedraw();
    }
  }

  private dismissInputBlock(): void {
    if (this.zoneDrawn) {
      this.clearInputZone();
    }
    this.menuVisibleLines = 0;
    this.zoneDrawn = false;
  }

  private attachKeys(): void {
    if (this.keyHandler) return;

    this.keyHandler = (str, key) => {
      if (this.paused || !key) return;

      // Ctrl+C 由 REPL 全局 listener 处理

      if (key.ctrl && key.name === 'd') {
        if (this.buffer.length === 0) this.finishSubmit(null);
        return;
      }

      if (key.name === 'tab' && key.shift && this.currentOptions?.onModeCycle) {
        const next = this.currentOptions.onModeCycle();
        this.currentOptions = { ...this.currentOptions, mode: next };
        this.fullRedraw();
        return;
      }

      if (key.name === 'tab' && this.buffer.startsWith('/')) {
        const completed = completeSlashCommand(
          this.buffer,
          this.currentOptions?.slashCommands ?? []
        );
        if (completed) {
          this.buffer = completed;
          this.cursor = this.buffer.length;
          this.fullRedraw();
        }
        return;
      }

      // Vim：Esc 进 normal；normal 下 i/a/A/hjkl/x/dd
      if (this.vimEnabled && key.name === 'escape') {
        this.vimMode = 'normal';
        this.fullRedraw();
        return;
      }

      if (this.vimEnabled && this.vimMode === 'normal') {
        if (str === 'i') {
          this.vimMode = 'insert';
          this.fullRedraw();
          return;
        }
        if (str === 'a') {
          this.cursor = Math.min(this.buffer.length, this.cursor + 1);
          this.vimMode = 'insert';
          this.fullRedraw();
          return;
        }
        if (str === 'A') {
          this.cursor = this.buffer.length;
          this.vimMode = 'insert';
          this.fullRedraw();
          return;
        }
        if (str === 'h' || key.name === 'left') {
          this.cursor = Math.max(0, this.cursor - 1);
          this.fullRedraw();
          return;
        }
        if (str === 'l' || key.name === 'right') {
          this.cursor = Math.min(this.buffer.length, this.cursor + 1);
          this.fullRedraw();
          return;
        }
        if (str === '0') {
          this.cursor = 0;
          this.fullRedraw();
          return;
        }
        if (str === '$') {
          this.cursor = this.buffer.length;
          this.fullRedraw();
          return;
        }
        if (str === 'x') {
          if (this.cursor < this.buffer.length) {
            this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
            this.fullRedraw();
          }
          return;
        }
        if (str === 'd') {
          // 简化：dd 清行（连按 d 不追踪；单 d 也清行以满足最小可用）
          this.buffer = '';
          this.cursor = 0;
          this.fullRedraw();
          return;
        }
        if (key.name === 'return') {
          if (this.buffer.trim().length === 0) return;
          this.finishSubmit(this.buffer);
        }
        return;
      }

      if (key.name === 'return') {
        if (this.buffer.trim().length === 0) return;
        this.finishSubmit(this.buffer);
        return;
      }

      if (key.name === 'backspace') {
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor -= 1;
          this.fullRedraw();
        }
        return;
      }

      if (key.name === 'left') {
        this.cursor = Math.max(0, this.cursor - 1);
        this.fullRedraw();
        return;
      }
      if (key.name === 'right') {
        this.cursor = Math.min(this.buffer.length, this.cursor + 1);
        this.fullRedraw();
        return;
      }

      if (str && !key.ctrl && !key.meta) {
        this.buffer = this.buffer.slice(0, this.cursor) + str + this.buffer.slice(this.cursor);
        this.cursor += str.length;
        this.fullRedraw();
      }
    };

    process.stdin.on('keypress', this.keyHandler);
  }

  private detachKeys(): void {
    if (!this.keyHandler) return;
    process.stdin.off('keypress', this.keyHandler);
    this.keyHandler = null;
  }

  private finishSubmit(value: string | null): void {
    this.detachKeys();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      this.removeInputBlock();
    }
    this.active = false;
    this.currentOptions = null;
    const done = this.resolve;
    this.resolve = null;
    done?.(value);
  }
}
