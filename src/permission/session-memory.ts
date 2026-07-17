/**
 * 会话级权限记忆（H2）— once=query 内；session=本会话后续免确认
 */

import { SessionState, ToolCall } from '../pkg/types.js';

/**
 * 生成可序列化的批准键。
 * Bash：包管理器/git 带上 subcommand，避免 `npm test` 批准 `npm publish`。
 */
export function approvalKey(tool: ToolCall): string {
  if (tool.name !== 'Bash') return tool.name;
  const cmd = String(tool.input['command'] ?? '').trim();
  if (!cmd) return 'Bash';
  const tokens = cmd.split(/\s+/);
  const first = (tokens[0] ?? 'Bash').replace(/^.*\//, '');
  const base = first.toLowerCase();

  if (['npm', 'npx', 'yarn', 'pnpm', 'bun'].includes(base)) {
    const sub = (tokens[1] ?? '').toLowerCase();
    if (sub === 'run' && tokens[2]) {
      return `Bash:${base}:run:${tokens[2]!.toLowerCase()}`;
    }
    if (sub) return `Bash:${base}:${sub}`;
    return `Bash:${base}`;
  }
  if (base === 'git') {
    const sub = (tokens[1] ?? '').toLowerCase();
    return sub ? `Bash:git:${sub}` : 'Bash:git';
  }

  return `Bash:${base}`;
}

export function ensureSessionApprovals(state: SessionState): string[] {
  if (!state.sessionApprovals) state.sessionApprovals = [];
  return state.sessionApprovals;
}

export function hasSessionApproval(state: SessionState, tool: ToolCall): boolean {
  const list = state.sessionApprovals;
  if (!list || list.length === 0) return false;
  return list.includes(approvalKey(tool));
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
