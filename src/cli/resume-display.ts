/**
 * /resume 纯文本 + 应用逻辑 — REPL / TUI 共用
 */

import type { SessionState } from '../pkg/types.js';
import {
  getSessionResume,
  type SessionResume,
  type SessionInfo,
} from './resume.js';

const MAX_LIST = 10;

export function formatResumeListLines(
  resume: SessionResume = getSessionResume(),
  limit = MAX_LIST
): string[] {
  const sessions = resume.list();
  if (sessions.length === 0) {
    return ['No saved sessions found.', 'Usage: /resume <sessionId>'];
  }
  const lines = ['Saved sessions:'];
  for (const s of sessions.slice(0, limit)) {
    lines.push(formatResumeSessionLine(s));
  }
  if (sessions.length > limit) {
    lines.push(`  ... and ${sessions.length - limit} more`);
  }
  lines.push('Usage: /resume <sessionId>');
  return lines;
}

export function formatResumeSessionLine(s: SessionInfo): string {
  const mtime = s.modified.toISOString().slice(0, 19).replace('T', ' ');
  return `  ${mtime}  ${s.id}  (${s.messageCount} msgs, ${s.mode})`;
}

/** 加载失败返回 error 行；成功返回 state */
export function loadResumeSession(
  id: string,
  resume: SessionResume = getSessionResume()
): { ok: true; state: SessionState } | { ok: false; lines: string[] } {
  const state = resume.load(id);
  if (!state) {
    return { ok: false, lines: [`Session not found: ${id}`] };
  }
  return { ok: true, state };
}

/** 把已加载会话字段写回 live SessionState（保持引用，供 QueryEngine 复用） */
export function applySessionState(target: SessionState, source: SessionState): void {
  target.sessionId = source.sessionId;
  target.messages = source.messages;
  target.toolCallHistory = source.toolCallHistory ?? [];
  target.maxOutputTokensRecoveryCount = source.maxOutputTokensRecoveryCount ?? 0;
  target.mode = source.mode;
  target.hooks = source.hooks;
  target.compactionHistory = source.compactionHistory ?? [];
  target.sessionApprovals = source.sessionApprovals;
  target.checkpointIndex = source.checkpointIndex;
}

export function formatResumeSuccess(state: SessionState): string {
  return `Resumed session ${state.sessionId} (${state.messages.length} messages, mode=${state.mode})`;
}
