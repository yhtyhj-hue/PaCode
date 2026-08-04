/**
 * REPL 输入区 UI — PaCode 风格：圆角框、青绿强调色、自适应宽度
 *
 * 所有宽度按终端可见列计算（CJK/emoji = 2），框线与状态栏跟终端自适应。
 */

import stringWidth from 'string-width';
import { PermissionMode } from '../pkg/types.js';
import { runStatuslineHook, type StatuslineContext } from './statusline.js';

export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const CYAN = '\x1b[36m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';
export const MAGENTA = '\x1b[35m';
/** 合成预览同款青绿 #2dd4bf */
export const TEAL = '\x1b[38;2;45;212;191m';
export const BRIGHT_CYAN = '\x1b[96m';

/** @deprecated 用 getUiWidth()；保留常量以免外部硬依赖断裂 */
export const REPL_UI_WIDTH = 120;

/** 终端列数（保底 40） */
export function getTerminalColumns(): number {
  const cols = process.stdout.columns ?? 80;
  return Math.max(40, cols);
}

/**
 * UI 可用宽度 = 终端列数 - margin。
 * margin 默认 0：边框顶满终端，不再留大片右边空白。
 */
export function getUiWidth(margin = 0): number {
  return Math.max(40, getTerminalColumns() - margin);
}

/** 终端可见列宽（CJK/emoji 等宽字符按 2 列计） */
export function visibleWidth(text: string): number {
  // eslint-disable-next-line no-control-regex -- 匹配 ANSI SGR 序列
  const stripped = text.replace(/\u001b\[[0-9;]*m/g, '');
  return stringWidth(stripped);
}

/** 按可见宽度右侧补空格；过长则截断 */
export function padEndVisible(text: string, width: number): string {
  const w = visibleWidth(text);
  if (w === width) return text;
  if (w < width) return text + ' '.repeat(width - w);
  return truncateVisible(text, width);
}

/** 按可见宽度截断并加省略号 */
export function truncateVisible(text: string, maxWidth: number): string {
  if (visibleWidth(text) <= maxWidth) return text;
  if (maxWidth <= 1) return '…';
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/\u001b\[[0-9;]*m/g, '');
  let out = '';
  for (const ch of plain) {
    if (visibleWidth(out + ch) > maxWidth - 1) break;
    out += ch;
  }
  return `${out}…`;
}

export type BoxStyle = 'rounded' | 'ascii';

/**
 * 绘制对齐方框。默认圆角 Unicode（╭─╮│╰─╯），对齐按 visibleWidth。
 */
export function formatBox(
  contentLines: string[],
  options: {
    width?: number;
    indent?: number;
    padding?: number;
    style?: BoxStyle;
    /** 边框颜色 ANSI（不含 RESET） */
    borderColor?: string;
  } = {}
): string {
  const indent = ' '.repeat(options.indent ?? 0);
  const padding = options.padding ?? 2;
  const outer = options.width ?? getUiWidth(options.indent ?? 0);
  const inner = Math.max(4, outer - 2);
  const style = options.style ?? 'rounded';
  const bc = options.borderColor ?? DIM;
  const h = style === 'ascii' ? '-' : '─';
  const v = style === 'ascii' ? '|' : '│';
  const tl = style === 'ascii' ? '+' : '╭';
  const tr = style === 'ascii' ? '+' : '╮';
  const bl = style === 'ascii' ? '+' : '╰';
  const br = style === 'ascii' ? '+' : '╯';
  const dash = h.repeat(inner);

  const rows = contentLines.map((line) => {
    const body = `${' '.repeat(padding)}${line}`;
    const cell = padEndVisible(body, inner);
    return `${indent}${bc}${v}${RESET}${cell}${bc}${v}${RESET}`;
  });

  return [
    `${indent}${bc}${tl}${dash}${tr}${RESET}`,
    ...rows,
    `${indent}${bc}${bl}${dash}${br}${RESET}`,
  ].join('\n');
}

export function formatReplBorder(width = getUiWidth()): string {
  return `${DIM}${'─'.repeat(width)}${RESET}`;
}

/** 对话区用户消息 */
export function formatUserMessage(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;
  const suffix = message.includes('\n') ? `${DIM}...${RESET}` : '';
  return `${TEAL}${BOLD}›${RESET} ${firstLine}${suffix}`;
}

/** 输入行提示符：青绿 ›（与合成预览一致） */
export function formatInputPrompt(): string {
  return `${TEAL}${BOLD}›${RESET} `;
}

/** Claude Code 风格权限模式文案 */
export function formatModeStatusLabel(mode: PermissionMode): string {
  switch (mode) {
    case PermissionMode.ACCEPT_EDITS:
      return 'accept edits on';
    case PermissionMode.PLAN:
      return 'plan mode';
    case PermissionMode.AUTO:
      return 'auto mode';
    case PermissionMode.DONT_ASK:
      return "don't ask mode";
    case PermissionMode.BYPASS:
      return 'bypass mode';
    case PermissionMode.BUBBLE:
      return 'bubble mode';
    default:
      return 'normal mode';
  }
}

/** 553.6k tokens 格式 */
export function formatTokenDisplay(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M tokens`;
  }
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return `${k.toFixed(1)}k tokens`;
  }
  return `${tokens} tokens`;
}

export function formatStatusBarLeft(mode: PermissionMode): string {
  const label = formatModeStatusLabel(mode);
  return (
    `${TEAL}››${RESET} ${TEAL}${label}${RESET}` +
    `${DIM} (shift+tab to cycle) · ctrl+c to interrupt · ctrl+o to expand${RESET}`
  );
}

export function formatStatusBarRight(tokens: number): string {
  const tokenStr = formatTokenDisplay(tokens);
  return `${DIM}new task? /clear to save ${RESET}${TEAL}${tokenStr}${RESET}`;
}

/** 左对齐模式 + 右对齐 token，中间空格填充；可选 statusline 钩子追加 */
export function formatStatusBar(
  mode: PermissionMode,
  tokens: number,
  width = getUiWidth(),
  statusCtx?: Omit<StatuslineContext, 'mode' | 'tokens'>
): string {
  const hook = runStatuslineHook({
    mode,
    tokens,
    model: statusCtx?.model,
    cwd: statusCtx?.cwd,
    sessionId: statusCtx?.sessionId,
  });
  const rightBase = formatStatusBarRight(tokens);
  const right = hook
    ? `${DIM}${hook}${RESET} ${rightBase}`
    : rightBase;
  let left = formatStatusBarLeft(mode);
  const rightW = visibleWidth(right);

  // 窄终端：缩短左侧提示，保证整体 ≤ width
  if (visibleWidth(left) + rightW + 1 > width) {
    const label = formatModeStatusLabel(mode);
    left = `${TEAL}››${RESET} ${TEAL}${label}${RESET}${DIM} · esc${RESET}`;
  }
  if (visibleWidth(left) + rightW + 1 > width) {
    left = `${TEAL}››${RESET} ${TEAL}${formatModeStatusLabel(mode)}${RESET}`;
  }

  const pad = Math.max(1, width - visibleWidth(left) - rightW);
  return padEndVisible(left + ' '.repeat(pad) + right, width);
}

/** 完整四行输入区：上横线 → 输入行 → 下横线 → 状态栏（宽度跟终端） */
export function formatInputAreaBlock(
  mode: PermissionMode,
  tokens: number,
  input = '',
  width = getUiWidth(),
  options?: { statusOverride?: string; colorizeInput?: (s: string) => string }
): string {
  const displayInput = options?.colorizeInput ? options.colorizeInput(input) : input;
  const status =
    options?.statusOverride !== undefined
      ? padEndVisible(`${DIM}${options.statusOverride}${RESET}`, width)
      : formatStatusBar(mode, tokens, width);
  return `${formatReplBorder(width)}\n${formatInputPrompt()}${displayInput}\n${formatReplBorder(width)}\n${status}`;
}

/** 输入行上方：上横线 + 状态栏 + 下横线（readline 兼容布局，已弃用） */
export function formatInputAreaHeader(
  mode: PermissionMode,
  tokens: number,
  width = getUiWidth()
): string {
  return `${formatReplBorder(width)}\n${formatStatusBar(mode, tokens, width)}\n${formatReplBorder(width)}`;
}

/** @deprecated 使用 formatInputAreaBlock */
export function formatInputFooter(mode: PermissionMode, tokens: number): string {
  return formatInputAreaHeader(mode, tokens);
}
