/**
 * Permission mode cycling (Shift+Tab) — mirrors Claude Code UX
 */

import { PermissionMode } from '../pkg/types.js';

/** Shift+Tab 循环子集：不含 AUTO/DONT_ASK/BYPASS（需显式 /mode 确认） */
export const SHIFT_TAB_MODES: readonly PermissionMode[] = [
  PermissionMode.DEFAULT,
  PermissionMode.ACCEPT_EDITS,
  PermissionMode.PLAN,
];

/** 下一个 Shift+Tab 模式；当前不在子集时回到 DEFAULT */
export function cyclePermissionMode(current: PermissionMode): PermissionMode {
  const idx = SHIFT_TAB_MODES.indexOf(current);
  if (idx === -1) return PermissionMode.DEFAULT;
  return SHIFT_TAB_MODES[(idx + 1) % SHIFT_TAB_MODES.length]!;
}
