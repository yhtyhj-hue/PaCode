/**
 * Permission System - 7 modes
 */

import {
  PermissionMode,
  PermissionCheckRequest,
  PermissionCheckResult,
  ToolCall,
} from '../pkg/types.js';

export class PermissionSystem {
  check(request: PermissionCheckRequest): PermissionCheckResult {
    const { tool, mode } = request;

    switch (mode) {
      case PermissionMode.PLAN:
        return { allowed: false, reason: 'Plan mode: no execution' };
      case PermissionMode.BYPASS:
        return { allowed: true };
      case PermissionMode.DEFAULT:
      case PermissionMode.AUTO:
        return { allowed: true, requiresInteraction: true, interactionType: 'confirm' };
      case PermissionMode.ACCEPT_EDITS:
        if (['Edit', 'Write', 'Read', 'Glob', 'Grep'].includes(tool.name)) return { allowed: true };
        return { allowed: true, requiresInteraction: true, interactionType: 'confirm' };
      case PermissionMode.DONT_ASK:
        if (this.isDestructive(tool)) return { allowed: false, reason: 'Destructive operation' };
        return { allowed: true };
      case PermissionMode.BUBBLE:
        return { allowed: true };
      default:
        return { allowed: false, reason: 'Unknown mode' };
    }
  }

  private isDestructive(tool: ToolCall): boolean {
    if (tool.name === 'Bash') {
      const cmd = String(tool.input['command'] ?? '');
      return /\b(rm\s+-rf|DROP\s+TABLE|git\s+push\s+--force)\b/i.test(cmd);
    }
    return false;
  }
}
