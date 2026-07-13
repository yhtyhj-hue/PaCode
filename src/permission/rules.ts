/**
 * Permission rule engine — deny-first pattern matching
 */

import { ToolCall, PermissionCheckResult } from '../pkg/types.js';

export interface PermissionRules {
  allow?: string[];
  deny?: string[];
  ask?: string[];
}

/** 解析 "Bash(ls *)" 或 "Read" 规则 */
function matchRule(rule: string, tool: ToolCall): boolean {
  const bashMatch = rule.match(/^Bash\((.+)\)$/i);
  if (bashMatch) {
    if (tool.name !== 'Bash') return false;
    const pattern = bashMatch[1]!.trim();
    const command = String(tool.input['command'] ?? '');
    return globMatch(pattern, command);
  }

  return tool.name === rule;
}

function globMatch(pattern: string, text: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(text);
}

/**
 * 规则优先级：deny > ask > allow
 * 无匹配返回 null，交给 mode 逻辑
 */
export function matchPermissionRules(
  tool: ToolCall,
  rules?: PermissionRules
): PermissionCheckResult | null {
  if (!rules) return null;

  for (const rule of rules.deny ?? []) {
    if (matchRule(rule, tool)) {
      return { allowed: false, reason: `Denied by rule: ${rule}` };
    }
  }

  for (const rule of rules.ask ?? []) {
    if (matchRule(rule, tool)) {
      return { allowed: true, requiresInteraction: true, interactionType: 'confirm' };
    }
  }

  for (const rule of rules.allow ?? []) {
    if (matchRule(rule, tool)) {
      return { allowed: true };
    }
  }

  return null;
}
