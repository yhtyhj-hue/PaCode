/**
 * Prompt caching — 显式注入 Anthropic `cache_control: ephemeral` 断点。
 *
 * 长会话中把稳定前缀（system prompt、工具定义、历史消息）标记为可缓存，
 * 后续请求命中缓存可显著降低 input token 成本与延迟。
 *
 * 断点策略（≤4 个上限内用 3 个）：
 *   1. system prompt 末尾
 *   2. 工具定义列表末尾
 *   3. 最后一条消息末尾（会话增量缓存）
 *
 * 全部为纯函数、不可变：返回新对象，从不修改入参。
 */

import type Anthropic from '@anthropic-ai/sdk';

/** Anthropic ephemeral cache 标记（默认 ~5min TTL）。 */
export const EPHEMERAL_CACHE = Object.freeze({ type: 'ephemeral' as const });

type CacheControl = { type: 'ephemeral' };

/** string system prompt → 带 cache_control 的 text block 数组；空则 undefined。 */
export function withSystemCache(
  system: string | undefined
): Anthropic.Messages.TextBlockParam[] | undefined {
  if (!system) return undefined;
  return [{ type: 'text', text: system, cache_control: EPHEMERAL_CACHE }];
}

/** 复制工具列表并在最后一个工具打 cache_control（覆盖整个工具前缀）。 */
export function withToolsCache(
  tools: Anthropic.Messages.Tool[]
): Anthropic.Messages.Tool[] {
  if (tools.length === 0) return tools;
  return tools.map((tool, i) =>
    i === tools.length - 1
      ? ({ ...tool, cache_control: EPHEMERAL_CACHE } as Anthropic.Messages.Tool)
      : tool
  );
}

/** 复制消息列表并在最后一条消息的最后一个 content block 打 cache_control。 */
export function withMessagesCache(
  messages: Anthropic.MessageParam[]
): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const lastIndex = messages.length - 1;
  return messages.map((msg, i) => (i === lastIndex ? markLastBlock(msg) : msg));
}

function markLastBlock(message: Anthropic.MessageParam): Anthropic.MessageParam {
  const { content } = message;

  if (typeof content === 'string') {
    return {
      ...message,
      content: [{ type: 'text', text: content, cache_control: EPHEMERAL_CACHE }],
    };
  }

  if (content.length === 0) return message;

  const lastIndex = content.length - 1;
  const nextContent = content.map((block, i) =>
    i === lastIndex ? attachCache(block) : block
  );
  return { ...message, content: nextContent as Anthropic.MessageParam['content'] };
}

function attachCache(
  block: Anthropic.Messages.ContentBlockParam
): Anthropic.Messages.ContentBlockParam & { cache_control: CacheControl } {
  return { ...block, cache_control: EPHEMERAL_CACHE };
}
