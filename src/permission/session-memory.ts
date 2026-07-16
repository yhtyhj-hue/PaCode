/**
 * 会话级权限记忆（H2）— once=query 内；session=本会话后续免确认
 */

import { SessionState, ToolCall } from '../pkg/types.js';

/** 生成可序列化的批准键：工具名，或 Bash 首 token */
export function approvalKey(tool: ToolCall): string {
  if (tool.name !== 'Bash') return tool.name;
  const cmd = String(tool.input['command'] ?? '').trim();
  if (!cmd) return 'Bash';
  const first = cmd.split(/\s+/)[0] ?? 'Bash';
  // 去掉路径前缀，保留 basename（./npm → npm）
  const base = first.replace(/^.*\//, '');
  return `Bash:${base}`;
}

export function ensureSessionApprovals(state: SessionState): string[] {
  if (!state.sessionApprovals) state.sessionApprovals = [];
  return state.sessionApprovals;
}

export function hasSessionApproval(state: SessionState, tool: ToolCall): boolean {
  const list = state.sessionApprovals;
  if (!list || list.length === 0) return false;
  const key = approvalKey(tool);
  if (list.includes(key) || list.includes(tool.name)) return true;
  // Bash:npm 批准不自动批准所有 Bash；仅精确或工具级 Bash（若用户曾 always 全 Bash）
  return false;
}

export function rememberSessionApproval(state: SessionState, tool: ToolCall): void {
  const list = ensureSessionApprovals(state);
  const key = approvalKey(tool);
  if (!list.includes(key)) list.push(key);
}

/** 批确认通过后记住一组工具 */
export function rememberSessionApprovals(state: SessionState, tools: ToolCall[]): void {
  for (const t of tools) rememberSessionApproval(state, t);
}

export function clearSessionApprovals(state: SessionState): void {
  state.sessionApprovals = [];
}
