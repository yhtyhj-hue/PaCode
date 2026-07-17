/**
 * REPL 输入区 UI — Claude Code 风格边框、提示符、状态栏
 *
 * 所有宽度按终端可见列计算（CJK/emoji = 2），框线与状态栏跟终端自适应。
 */

import stringWidth from 'string-width';
import { PermissionMode } from '../pkg/types.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

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

/**
 * 绘制对齐方框。content 为框内可见行（可含 ANSI）。
 * 右边界 | 与上下 +---+ 必须对齐：内宽一律用 visibleWidth 垫平。
 */
export function formatBox(
  contentLines: string[],
  options: { width?: number; indent?: number; padding?: number } = {}
): string {
  const indent = ' '.repeat(options.indent ?? 0);
  const padding = options.padding ?? 2;
  const outer = options.width ?? getUiWidth(options.indent ?? 0);
  const inner = Math.max(4, outer - 2);
  const dash = '-'.repeat(inner);

  const rows = contentLines.map((line) => {
    const body = `${' '.repeat(padding)}${line}`;
    const cell = padEndVisible(body, inner);
    return `${indent}|${cell}|`;
  });

  return [`${indent}+${dash}+`, ...rows, `${indent}+${dash}+`].join('\n');
}

export function formatReplBorder(width = getUiWidth()): string {
  return `${DIM}${'─'.repeat(width)}${RESET}`;
}

/** 对话区用户消息（无输入框边框） */
export function formatUserMessage(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;
  const suffix = message.includes('\n') ? `${DIM}...${RESET}` : '';
  return `${BOLD}>${RESET} ${firstLine}${suffix}`;
}

/** 输入行提示符：`> ` */
export function formatInputPrompt(): string {
  return `${BOLD}>${RESET} `;
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
    `${MAGENTA}>>${RESET} ${MAGENTA}${label}${RESET}` +
    `${DIM} (shift+tab to cycle) · ctrl+c to interrupt · ctrl+o to expand${RESET}`
  );
}

export function formatStatusBarRight(tokens: number): string {
  const tokenStr = formatTokenDisplay(tokens);
  return `${DIM}new task? /clear to save ${RESET}${CYAN}${tokenStr}${RESET}`;
}

/** 左对齐模式 + 右对齐 token，中间空格填充（总宽不超过 width） */
export function formatStatusBar(
  mode: PermissionMode,
  tokens: number,
  width = getUiWidth()
): string {
  const right = formatStatusBarRight(tokens);
  let left = formatStatusBarLeft(mode);
  const rightW = visibleWidth(right);

  // 窄终端：缩短左侧提示，保证整体 ≤ width
  if (visibleWidth(left) + rightW + 1 > width) {
    const label = formatModeStatusLabel(mode);
    left = `${MAGENTA}>>${RESET} ${MAGENTA}${label}${RESET}${DIM} · esc${RESET}`;
  }
  if (visibleWidth(left) + rightW + 1 > width) {
    left = `${MAGENTA}>>${RESET} ${MAGENTA}${formatModeStatusLabel(mode)}${RESET}`;
  }

  const pad = Math.max(1, width - visibleWidth(left) - rightW);
  return padEndVisible(left + ' '.repeat(pad) + right, width);
}

/** 完整四行输入区：上横线 → 输入行 → 下横线 → 状态栏（宽度跟终端） */
export function formatInputAreaBlock(
  mode: PermissionMode,
  tokens: number,
  input = '',
  width = getUiWidth()
): string {
  return `${formatReplBorder(width)}\n${formatInputPrompt()}${input}\n${formatReplBorder(width)}\n${formatStatusBar(mode, tokens, width)}`;
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
