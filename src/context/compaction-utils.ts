/**
 * Compaction utilities — token estimate & message compression
 */

import { Message } from '../pkg/types.js';

const CHARS_PER_TOKEN = 4;
const SNIP_MAX_TOOL_CHARS = 2000;
const MICRO_MAX_TOOL_CHARS = 300;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function messageToText(content: Message['content']): string {
  if (typeof content === 'string') return content;
  return JSON.stringify(content);
}

/** 裁剪单条消息中的 tool_result 文本 */
export function truncateToolResultsInMessage(
  message: Message,
  maxChars: number
): Message {
  if (typeof message.content === 'string') {
    if (message.content.length <= maxChars) return message;
    return {
      ...message,
      content: message.content.slice(0, maxChars) + `\n...[truncated ${message.content.length - maxChars} chars]`,
    };
  }

  const content = message.content.map((block) => {
    if (block.type !== 'tool_result' || !block.toolResult) return block;

    const compressed = block.toolResult.content.map((c) => {
      if (c.type !== 'text' || c.text.length <= maxChars) return c;
      return {
        type: 'text' as const,
        text: c.text.slice(0, maxChars) + `\n...[truncated]`,
      };
    });

    return { ...block, toolResult: { ...block.toolResult, content: compressed } };
  });

  return { ...message, content };
}

/** Snip 层：保留最近消息并截断超长 tool 输出 */
export function snipMessages(messages: Message[], keep = 20): Message[] {
  return messages.slice(-keep).map((m) => truncateToolResultsInMessage(m, SNIP_MAX_TOOL_CHARS));
}

/** Microcompact 层：tool 结果压成一行摘要 */
export function microcompactMessages(messages: Message[], keep = 10): Message[] {
  return messages.slice(-keep).map((message) => {
    if (typeof message.content === 'string') {
      if (message.content.length <= MICRO_MAX_TOOL_CHARS) return message;
      return {
        ...message,
        content: message.content.slice(0, MICRO_MAX_TOOL_CHARS) + '...[microcompact]',
      };
    }

    const content = message.content.map((block) => {
      if (block.type !== 'tool_result' || !block.toolResult) return block;

      const summary = block.toolResult.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text.replace(/\s+/g, ' ').trim())
        .join(' ')
        .slice(0, MICRO_MAX_TOOL_CHARS);

      return {
        ...block,
        toolResult: {
          ...block.toolResult,
          content: [{ type: 'text' as const, text: summary || '[empty]' }],
        },
      };
    });

    return { ...message, content };
  });
}

export function countContextTokens(systemPrompt: string, messages: Message[]): number {
  let total = estimateTokens(systemPrompt);
  for (const m of messages) {
    total += estimateTokens(messageToText(m.content));
  }
  return total;
}

/** 将消息列表格式化为摘要输入 */
export function formatMessagesForSummary(messages: Message[]): string {
  return messages
    .map((m) => `${m.role.toUpperCase()}:\n${messageToText(m.content)}`)
    .join('\n\n---\n\n');
}

/** L4 确定性折叠：旧消息压成 bullet 摘要 */
export function collapseOlderMessages(messages: Message[], keepRecent = 4): Message[] {
  if (messages.length <= keepRecent) return messages;

  const older = messages.slice(0, messages.length - keepRecent);
  const recent = messages.slice(-keepRecent);
  const summary = older
    .map((m) => `- ${m.role}: ${messageToText(m.content).replace(/\s+/g, ' ').slice(0, 120)}`)
    .join('\n');

  return [
    {
      role: 'user',
      content: `<context-collapse>\n${summary}\n</context-collapse>`,
      timestamp: Date.now(),
    },
    ...recent,
  ];
}
