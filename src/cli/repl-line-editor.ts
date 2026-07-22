/**
 * REPL 行编辑器 — 底部固定输入框 + CC 风格粘贴芯片
 */

import readline from 'node:readline';
import { PermissionMode, type ImageSource } from '../pkg/types.js';
import { formatInputAreaBlock, formatInputPrompt, visibleWidth } from './repl-ui.js';
import {
  filterSlashCommands,
  formatSlashMenu,
  completeSlashCommand,
  SlashMenuEntry,
} from './slash-menu.js';
import { InputHistory } from './input-history.js';
import {
  PastedContent,
  colorizePasteChips,
  expandPastedTextRefs,
  extractImagesAndStripRefs,
  formatImageRef,
  formatPastedTextRef,
  getPastedTextRefNumLines,
  hasCollapsedTextPaste,
  shouldCollapsePaste,
} from './paste-chips.js';
import { tryLoadImageFromPastedPath, tryReadClipboardImage } from './clipboard-image.js';

export interface ReplLineOptions {
  mode: PermissionMode;
  tokens: number;
  isFirst?: boolean;
  slashCommands?: SlashMenuEntry[];
  /** 覆盖默认提示符（如 y/N 确认） */
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

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';

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
  private zoneDrawn = false;
  private vimEnabled = false;
  private vimMode: VimEditorMode = 'insert';

  /** 粘贴芯片存储 */
  private pasted = new Map<number, PastedContent>();
  private nextPasteId = 1;
  private bracketedBuf: string | null = null;
  private pendingImages: ImageSource[] = [];
  private lastDisplayText = '';

  /** 输入历史（↑↓）；slash 菜单选中下标 */
  private history = new InputHistory();
  private slashSelectedIndex = 0;

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

  /** 提交后取出图片附件 */
  takePendingImages(): ImageSource[] {
    const imgs = this.pendingImages;
    this.pendingImages = [];
    return imgs;
  }

  /** 提交前输入区展示文案（含芯片，供 printUserTurn） */
  getLastDisplayText(): string {
    return this.lastDisplayText;
  }

  pause(): void {
    this.paused = true;
    this.detachKeys();
    if (process.stdin.isTTY) {
      process.stdout.write(DISABLE_BRACKETED_PASTE);
      process.stdin.setRawMode(false);
    }
  }

  resume(): void {
    if (!process.stdin.isTTY) return;
    this.paused = false;
    if (this.active) {
      process.stdin.setRawMode(true);
      process.stdout.write(ENABLE_BRACKETED_PASTE);
      if (this.currentOptions) {
        this.fullRedraw();
        this.attachKeys();
      }
    }
  }

  close(): void {
    this.detachKeys();
    this.active = false;
    if (process.stdin.isTTY) {
      process.stdout.write(DISABLE_BRACKETED_PASTE);
      process.stdin.setRawMode(false);
    }
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
    this.pasted.clear();
    this.nextPasteId = 1;
    this.bracketedBuf = null;
    this.pendingImages = [];
    this.lastDisplayText = '';
    this.slashSelectedIndex = 0;
    this.history.resetBrowse();
    this.active = true;
    this.currentOptions = options;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(ENABLE_BRACKETED_PASTE);

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

  private fullRedraw(): void {
    if (!this.currentOptions) return;

    if (this.zoneDrawn) {
      this.clearInputZone();
    } else if (!this.currentOptions.isFirst) {
      process.stdout.write('\n');
    }

    const slashEntries = this.buffer.startsWith('/')
      ? filterSlashCommands(this.buffer, this.currentOptions.slashCommands ?? [])
      : [];
    const menuLines = formatSlashMenu(
      slashEntries,
      24,
      undefined,
      slashEntries.length > 0 ? this.slashSelectedIndex : -1
    );

    for (const line of menuLines) {
      process.stdout.write(`${line}\n`);
    }

    const statusOverride = hasCollapsedTextPaste(this.buffer, this.pasted)
      ? 'paste again to expand'
      : undefined;

    process.stdout.write(
      `${formatInputAreaBlock(
        this.currentOptions.mode,
        this.currentOptions.tokens,
        this.buffer,
        undefined,
        {
          statusOverride,
          colorizeInput: colorizePasteChips,
        }
      )}\n`
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

  cancelReadLine(): void {
    if (this.active) this.finishSubmit(null);
  }

  cancelForExit(): void {
    if (!this.active) return;
    this.detachKeys();
    if (process.stdin.isTTY) {
      process.stdout.write(DISABLE_BRACKETED_PASTE);
      process.stdin.setRawMode(false);
      this.dismissInputBlock();
    }
    this.active = false;
    this.currentOptions = null;
    const done = this.resolve;
    this.resolve = null;
    done?.(null);
  }

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

  injectText(text: string): boolean {
    if (!this.active || this.paused) return false;
    const t = text.trim();
    if (!t) return false;
    this.insertRawAtCursor(t);
    this.fullRedraw();
    return true;
  }

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

  /** 当前 slash 过滤列表（供 ↑↓ / Enter） */
  private currentSlashEntries(): SlashMenuEntry[] {
    if (!this.buffer.startsWith('/') || !this.currentOptions) return [];
    return filterSlashCommands(this.buffer, this.currentOptions.slashCommands ?? []);
  }

  private clampSlashSelection(): void {
    const entries = this.currentSlashEntries();
    if (entries.length === 0) {
      this.slashSelectedIndex = 0;
      return;
    }
    if (this.slashSelectedIndex < 0) this.slashSelectedIndex = 0;
    if (this.slashSelectedIndex >= entries.length) {
      this.slashSelectedIndex = entries.length - 1;
    }
  }

  /** 缓冲变更后：重置/钳制菜单选中 */
  private afterBufferEdit(): void {
    this.clampSlashSelection();
    this.fullRedraw();
  }

  private navigateSlash(delta: number): boolean {
    const entries = this.currentSlashEntries();
    if (entries.length === 0) return false;
    const n = entries.length;
    this.slashSelectedIndex = (this.slashSelectedIndex + delta + n) % n;
    this.fullRedraw();
    return true;
  }

  private navigateHistory(dir: 'up' | 'down'): void {
    const next =
      dir === 'up' ? this.history.up(this.buffer) : this.history.down(this.buffer);
    this.buffer = next;
    this.cursor = this.buffer.length;
    this.slashSelectedIndex = 0;
    this.clampSlashSelection();
    this.fullRedraw();
  }

  /** Enter：若 slash 菜单打开则采用高亮项再提交 */
  private submitFromEnter(): void {
    if (this.buffer.trim().length === 0) return;
    const entries = this.currentSlashEntries();
    if (entries.length > 0 && this.buffer.startsWith('/')) {
      const selected = entries[this.slashSelectedIndex];
      if (selected) {
        const parts = this.buffer.split(/\s+/);
        const rest = parts.length > 1 ? this.buffer.slice(parts[0]!.length) : '';
        this.buffer = selected.command + rest;
        this.cursor = this.buffer.length;
      }
    }
    this.finishSubmit(this.buffer);
  }

  private insertRawAtCursor(text: string): void {
    this.buffer = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor);
    this.cursor += text.length;
  }

  private insertTextChip(text: string): void {
    const id = this.nextPasteId++;
    const lines = getPastedTextRefNumLines(text);
    const chip = formatPastedTextRef(id, lines);
    this.pasted.set(id, { id, type: 'text', content: text });
    this.insertRawAtCursor(chip);
  }

  private insertImageChip(img: { mediaType: string; data: string }): void {
    const id = this.nextPasteId++;
    const chip = formatImageRef(id);
    this.pasted.set(id, {
      id,
      type: 'image',
      content: img.data,
      mediaType: img.mediaType,
    });
    this.insertRawAtCursor(chip);
  }

  /** 处理粘贴块（bracketed 或大块输入） */
  handlePaste(raw: string): void {
    // 再粘贴一次 → 展开已有文本芯片
    if (hasCollapsedTextPaste(this.buffer, this.pasted)) {
      this.buffer = expandPastedTextRefs(this.buffer, this.pasted);
      this.cursor = this.buffer.length;
      this.fullRedraw();
      return;
    }

    const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    if (!text.trim()) {
      const img = tryReadClipboardImage();
      if (img) this.insertImageChip(img);
      this.fullRedraw();
      return;
    }

    const fromPath = tryLoadImageFromPastedPath(text);
    if (fromPath) {
      this.insertImageChip(fromPath);
      this.fullRedraw();
      return;
    }

    if (shouldCollapsePaste(text)) {
      this.insertTextChip(text);
    } else {
      this.insertRawAtCursor(text);
    }
    this.fullRedraw();
  }

  private feedInputChunk(str: string): void {
    // Bracketed paste 状态机
    if (this.bracketedBuf !== null) {
      this.bracketedBuf += str;
      const end = this.bracketedBuf.indexOf(PASTE_END);
      if (end >= 0) {
        const body = this.bracketedBuf.slice(0, end);
        this.bracketedBuf = null;
        this.handlePaste(body);
      }
      return;
    }

    if (str.includes(PASTE_START)) {
      const start = str.indexOf(PASTE_START);
      const after = str.slice(start + PASTE_START.length);
      const end = after.indexOf(PASTE_END);
      if (end >= 0) {
        this.handlePaste(after.slice(0, end));
        const rest = after.slice(end + PASTE_END.length);
        if (rest) this.feedInputChunk(rest);
      } else {
        this.bracketedBuf = after;
      }
      return;
    }

    // 非 bracketed：多字符且应折叠 → 当粘贴
    if (str.length > 1 && shouldCollapsePaste(str)) {
      this.handlePaste(str);
      return;
    }

    this.insertRawAtCursor(str);
    this.slashSelectedIndex = 0;
    this.afterBufferEdit();
  }

  private attachKeys(): void {
    if (this.keyHandler) return;

    this.keyHandler = (str, key) => {
      if (this.paused || !key) return;

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
          this.buffer = '';
          this.cursor = 0;
          this.fullRedraw();
          return;
        }
        if (key.name === 'return') {
          this.submitFromEnter();
        }
        return;
      }

      if (key.name === 'return') {
        this.submitFromEnter();
        return;
      }

      if (key.name === 'up') {
        // 历史浏览中优先 ↑↓ 历史；否则有 slash 菜单则选菜单
        if (this.history.isBrowsing()) {
          this.navigateHistory('up');
        } else if (!this.navigateSlash(-1)) {
          this.navigateHistory('up');
        }
        return;
      }
      if (key.name === 'down') {
        if (this.history.isBrowsing()) {
          this.navigateHistory('down');
        } else if (!this.navigateSlash(1)) {
          this.navigateHistory('down');
        }
        return;
      }

      if (key.name === 'backspace') {
        if (this.cursor > 0) {
          // 芯片整块删除：若光标落在 ] 后，尝试删整个 [...]
          const before = this.buffer.slice(0, this.cursor);
          const chip = before.match(/\[(?:Pasted text|Image) #[^\]]+\]$/);
          if (chip) {
            const start = this.cursor - chip[0].length;
            this.buffer = this.buffer.slice(0, start) + this.buffer.slice(this.cursor);
            this.cursor = start;
          } else {
            this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
            this.cursor -= 1;
          }
          this.slashSelectedIndex = 0;
          this.afterBufferEdit();
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
        this.feedInputChunk(str);
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
      process.stdout.write(DISABLE_BRACKETED_PASTE);
      process.stdin.setRawMode(false);
      this.removeInputBlock();
    }
    this.active = false;
    this.currentOptions = null;

    let out: string | null = value;
    if (value !== null) {
      this.lastDisplayText = value;
      const stripped = extractImagesAndStripRefs(value, this.pasted);
      this.pendingImages = stripped.images;
      out = expandPastedTextRefs(stripped.text, this.pasted);
      if (out.trim()) this.history.push(out);
    }

    const done = this.resolve;
    this.resolve = null;
    done?.(out);
  }
}
