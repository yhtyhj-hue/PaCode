/**
 * Tool permissionMode gate — Layer 4: minimum session mode per tool
 */

import { PermissionMode, PermissionCheckResult } from '../pkg/types.js';

/** 会话权限从弱到强的顺序（BYPASS/BUBBLE 视为最高） */
const MODE_RANK: Record<PermissionMode, number> = {
  [PermissionMode.PLAN]: 0,
  [PermissionMode.DEFAULT]: 1,
  [PermissionMode.ACCEPT_EDITS]: 2,
  [PermissionMode.AUTO]: 3,
  [PermissionMode.DONT_ASK]: 4,
  [PermissionMode.BYPASS]: 5,
  [PermissionMode.BUBBLE]: 5,
};

export function getModeRank(mode: PermissionMode): number {
  return MODE_RANK[mode] ?? 0;
}

/** 当前 session mode 是否满足 tool 声明的最低 permissionMode */
export function checkToolPermissionGate(
  sessionMode: PermissionMode,
  requiredMode: PermissionMode = PermissionMode.DEFAULT
): PermissionCheckResult | null {
  if (sessionMode === PermissionMode.BYPASS || sessionMode === PermissionMode.BUBBLE) {
    return null;
  }

  if (getModeRank(sessionMode) < getModeRank(requiredMode)) {
    return {
      allowed: false,
      reason: `Tool requires ${requiredMode} mode or higher (current: ${sessionMode})`,
    };
  }

  return null;
}

export function satisfiesToolPermission(
  sessionMode: PermissionMode,
  requiredMode: PermissionMode
): boolean {
  return checkToolPermissionGate(sessionMode, requiredMode) === null;
}
