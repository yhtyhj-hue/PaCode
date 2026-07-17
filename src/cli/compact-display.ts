/**
 * /compact 共享逻辑 — 返回纯文本行；可注入 summarizeFn 做测试
 */

import type { SessionState } from '../pkg/types.js';
import {
  compactSession,
  type SessionCompactOptions,
  type SessionCompactResult,
} from '../context/session-compactor.js';

export interface CompactDisplayOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  instructions?: string;
  summarizeFn?: SessionCompactOptions['summarizeFn'];
  compactFn?: typeof compactSession;
}

export type CompactDisplayOutcome =
  | { ok: true; lines: string[]; result: SessionCompactResult }
  | { ok: false; lines: string[] };

/** 执行会话压缩并生成状态行（无 ANSI） */
export async function runCompactForDisplay(
  session: SessionState | null | undefined,
  options: CompactDisplayOptions = {}
): Promise<CompactDisplayOutcome> {
  if (!session) {
    return { ok: false, lines: ['No active session to compact'] };
  }
  if (session.messages.length <= 4) {
    return {
      ok: false,
      lines: [`Not enough messages to compact (${session.messages.length})`],
    };
  }

  const compact = options.compactFn ?? compactSession;
  try {
    const result = await compact(session, {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      instructions: options.instructions?.trim() || undefined,
      summarizeFn: options.summarizeFn,
    });
    // 核心：把压缩后的消息写回同一 session 引用
    session.messages = result.session.messages;
    session.compactionHistory = result.session.compactionHistory;

    const lines = [
      `Compacted ${result.beforeCount} → ${result.afterCount} messages`,
    ];
    if (result.summary) {
      const preview = result.summary.split('\n')[0]?.slice(0, 80) ?? '';
      lines.push(
        `  Summary: ${preview}${result.summary.length > 80 ? '...' : ''}`
      );
    }
    return { ok: true, lines, result };
  } catch (error) {
    return {
      ok: false,
      lines: [
        `Compaction failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}
