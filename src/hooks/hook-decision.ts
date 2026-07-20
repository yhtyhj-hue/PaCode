/**
 * Hook stdout 决策协议（PostToolUse / Stop）
 *
 * PostToolUse JSON:
 *   {"decision":"allow"}
 *   {"decision":"block","reason":"..."}
 *   {"decision":"modify","content":[...],"isError":false}
 *
 * Stop JSON（可选）:
 *   {"decision":"continue"} | {"decision":"stop","reason":"..."}
 *
 * 非 JSON / 空 stdout → 无操作（兼容旧 fire-and-forget hooks）。
 */

import type { ToolResult } from '../pkg/types.js';

export type PostToolUseDecision =
  | { kind: 'allow' }
  | { kind: 'block'; reason: string }
  | { kind: 'modify'; result: ToolResult };

export type StopHookDecision =
  | { kind: 'continue' }
  | { kind: 'stop'; reason: string };

function tryParseJson(stdout: string): unknown | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/** 解析 PostToolUse stdout；无法识别则 allow（保持兼容） */
export function parsePostToolUseDecision(stdout: string): PostToolUseDecision {
  const raw = tryParseJson(stdout);
  if (!raw || typeof raw !== 'object') return { kind: 'allow' };
  const obj = raw as Record<string, unknown>;
  const decision = String(obj['decision'] ?? '').toLowerCase();
  if (decision === 'block') {
    return {
      kind: 'block',
      reason: String(obj['reason'] ?? 'Blocked by PostToolUse hook'),
    };
  }
  if (decision === 'modify') {
    const content = obj['content'];
    if (!Array.isArray(content)) return { kind: 'allow' };
    return {
      kind: 'modify',
      result: {
        content: content as ToolResult['content'],
        isError: Boolean(obj['isError']),
      },
    };
  }
  return { kind: 'allow' };
}

/** 应用单次决策到当前 tool result；exit 2 视为 block */
export function applyPostToolUseDecision(
  current: ToolResult,
  stdout: string,
  exitCode: number,
  hookName: string
): ToolResult {
  if (exitCode === 2) {
    return {
      content: [
        {
          type: 'text',
          text: `Tool result blocked by PostToolUse hook: ${hookName}`,
        },
      ],
      isError: true,
    };
  }
  const decision = parsePostToolUseDecision(stdout);
  if (decision.kind === 'block') {
    return {
      content: [{ type: 'text', text: decision.reason }],
      isError: true,
    };
  }
  if (decision.kind === 'modify') {
    return decision.result;
  }
  return current;
}

export function parseStopHookDecision(stdout: string): StopHookDecision {
  const raw = tryParseJson(stdout);
  if (!raw || typeof raw !== 'object') return { kind: 'continue' };
  const obj = raw as Record<string, unknown>;
  const decision = String(obj['decision'] ?? '').toLowerCase();
  if (decision === 'stop') {
    return {
      kind: 'stop',
      reason: String(obj['reason'] ?? 'Stopped by Stop hook'),
    };
  }
  return { kind: 'continue' };
}
