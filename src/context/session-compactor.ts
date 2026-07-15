/**
 * Session Compactor — LLM-powered /compact for REPL sessions
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  CompactionType,
  Message,
  SessionState,
} from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';

export interface SessionCompactOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  instructions?: string;
  /** 保留最近 N 条消息不压缩 */
  keepRecent?: number;
  /** 测试注入 */
  summarizeFn?: (prompt: string) => Promise<string>;
}

export interface SessionCompactResult {
  session: SessionState;
  beforeCount: number;
  afterCount: number;
  summary: string;
}

const DEFAULT_COMPACT_PROMPT = `Summarize the conversation below for context continuity.
Preserve: user goals, decisions, file paths, errors, and unfinished tasks.
Use concise bullet points. Do not invent facts.`;

/** 将 message content 转为可读文本 */
function messageToText(content: Message['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => {
      if (block.type === 'text') return block.text ?? '';
      if (block.type === 'tool_use') return `[tool_use: ${block.toolUse?.name}]`;
      if (block.type === 'tool_result') {
        const text = block.toolResult?.content
          ?.filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join(' ');
        return `[tool_result: ${text?.slice(0, 200) ?? ''}]`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function formatMessagesForSummary(messages: Message[]): string {
  return messages
    .map((m) => `${m.role.toUpperCase()}:\n${messageToText(m.content)}`)
    .join('\n\n---\n\n');
}

/** 用 LLM 压缩 session 历史，保留最近消息 */
export async function compactSession(
  session: SessionState,
  options: SessionCompactOptions = {}
): Promise<SessionCompactResult> {
  const log = new Logger({ prefix: 'SessionCompactor' });
  const keepRecent = options.keepRecent ?? 4;
  const beforeCount = session.messages.length;

  if (beforeCount <= keepRecent) {
    return {
      session,
      beforeCount,
      afterCount: beforeCount,
      summary: '',
    };
  }

  const toSummarize = session.messages.slice(0, beforeCount - keepRecent);
  const recent = session.messages.slice(beforeCount - keepRecent);
  const transcript = formatMessagesForSummary(toSummarize);

  const userPrompt = [
    options.instructions?.trim() || DEFAULT_COMPACT_PROMPT,
    '',
    transcript,
  ].join('\n');

  let summary: string;
  if (options.summarizeFn) {
    summary = await options.summarizeFn(userPrompt);
  } else {
    const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    const client = new Anthropic({ apiKey, baseURL: options.baseUrl });
    const response = await client.messages.create({
      model: options.model ?? 'claude-sonnet-4-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const block = response.content.find((b) => b.type === 'text');
    summary = block?.type === 'text' ? block.text : '[Compaction produced no summary]';
  }

  log.info(`Compacted ${toSummarize.length} messages → summary (${summary.length} chars)`);

  const compactMessage: Message = {
    role: 'user',
    content: `<compact>\n${summary}\n</compact>`,
    timestamp: Date.now(),
  };

  session.messages = [compactMessage, ...recent];
  session.compactionHistory.push({
    timestamp: Date.now(),
    type: CompactionType.AUTO_COMPACT,
    beforeTokens: beforeCount,
    afterTokens: session.messages.length,
  });

  return {
    session,
    beforeCount,
    afterCount: session.messages.length,
    summary,
  };
}
