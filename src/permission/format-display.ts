/**
 * /permissions 展示文案 — 真实规则 + 模式语义
 */

import { PermissionMode } from '../pkg/types.js';
import { PermissionRules } from './rules.js';
import { SHIFT_TAB_MODES } from './cycle-mode.js';

export function describePermissionMode(mode: PermissionMode): string {
  switch (mode) {
    case PermissionMode.PLAN:
      return 'no tool execution';
    case PermissionMode.DEFAULT:
      return 'auto-allow Read/Glob/Grep; confirm Bash/Edit/Write (CC-like)';
    case PermissionMode.ACCEPT_EDITS:
      return 'auto-approve Read/Edit/Write/Glob/Grep; confirm others';
    case PermissionMode.AUTO:
      return 'deterministic classifier (not ML)';
    case PermissionMode.DONT_ASK:
      return 'auto-approve except crude destructive regex';
    case PermissionMode.BYPASS:
      return 'skip interaction (deny rules still apply)';
    case PermissionMode.BUBBLE:
      return 'allow-all (internal / parent bubble)';
    default:
      return 'unknown';
  }
}

function formatRuleList(title: string, rules: string[] | undefined): string[] {
  if (!rules || rules.length === 0) {
    return [`  ${title}: (none)`];
  }
  return [`  ${title}:`, ...rules.map((r) => `    - ${r}`)];
}

/** 生成 /permissions 完整输出行（无 ANSI） */
export function formatPermissionsReport(
  mode: PermissionMode,
  rules?: PermissionRules
): string[] {
  const lines: string[] = [
    'Permission Rules',
    `  Current mode: ${mode} — ${describePermissionMode(mode)}`,
    `  Shift+Tab cycles: ${SHIFT_TAB_MODES.join(' → ')}`,
    '  Layer order: deny → plan block → ask/allow → tool-gate → mode',
    ...formatRuleList('deny', rules?.deny),
    ...formatRuleList('ask', rules?.ask),
    ...formatRuleList('allow', rules?.allow),
    '  Configure: ~/.claude/settings.json or .claude/settings.json → "permissions"',
    '  Example: { "permissions": { "deny": ["Bash(rm *)"], "ask": ["Bash"], "allow": ["Read"] } }',
  ];
  return lines;
}
