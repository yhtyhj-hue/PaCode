/**
 * Message Serializer - PaCode Message → Anthropic API format
 */

import type Anthropic from '@anthropic-ai/sdk';
import { ContentBlock, Message, ToolResult } from '../pkg/types.js';

type ApiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/** 将 ToolResult 转为 Anthropic tool_result content */
function toolResultContent(result: ToolResult): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

/** 单条 ContentBlock → Anthropic content block */
function serializeContentBlock(block: ContentBlock): ApiContentBlock | null {
  if (block.type === 'text') {
    return { type: 'text', text: block.text ?? '' };
  }

  if (block.type === 'tool_use' && block.toolUse) {
    return {
      type: 'tool_use',
      id: block.toolUse.id,
      name: block.toolUse.name,
      input: block.toolUse.input,
    };
  }

  if (block.type === 'tool_result' && block.toolResult && block.toolUseId) {
    return {
      type: 'tool_result',
      tool_use_id: block.toolUseId,
      content: toolResultContent(block.toolResult),
      is_error: block.toolResult.isError ?? false,
    };
  }

  return null;
}

/** 会话消息列表 → Anthropic messages 参数 */
export function serializeMessagesForApi(messages: Message[]): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role as 'user' | 'assistant', content: m.content };
      }

      const blocks = m.content
        .map(serializeContentBlock)
        .filter((b): b is ApiContentBlock => b !== null);

      return { role: m.role as 'user' | 'assistant', content: blocks as Anthropic.MessageParam['content'] };
    });
}

/** 模型响应 content → 持久化用的 ContentBlock[] */
export function responseContentToBlocks(
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >
): ContentBlock[] {
  return content.map((block) => {
    if (block.type === 'text') {
      return { type: 'text' as const, text: block.text };
    }
    return {
      type: 'tool_use' as const,
      toolUse: { id: block.id, name: block.name, input: block.input },
    };
  });
}
