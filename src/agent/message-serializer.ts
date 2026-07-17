/**
 * Message Serializer - PaCode Message → Anthropic API format
 */

import type Anthropic from '@anthropic-ai/sdk';
import { ContentBlock, Message, ToolResult } from '../pkg/types.js';

type ApiImageBlock = {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
};

type ApiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | ApiImageBlock;

/** 将 ToolResult 转为 Anthropic tool_result content（文本；图片另附注） */
function toolResultContent(result: ToolResult): string {
  const parts: string[] = [];
  for (const c of result.content) {
    if (c.type === 'text') parts.push(c.text);
    else if (c.type === 'image') {
      parts.push(`[image ${c.source.mediaType} omitted from tool_result string]`);
    }
  }
  return parts.join('\n');
}

/** G4：ImageSource → Anthropic image block（media_type snake_case） */
export function serializeImageSource(image: {
  type: 'base64' | 'url';
  mediaType: string;
  data: string;
}): ApiImageBlock {
  if (image.type === 'url') {
    return { type: 'image', source: { type: 'url', url: image.data } };
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mediaType,
      data: image.data,
    },
  };
}

/** 单条 ContentBlock → Anthropic content block */
function serializeContentBlock(block: ContentBlock): ApiContentBlock | null {
  if (block.type === 'text') {
    return { type: 'text', text: block.text ?? '' };
  }

  if (block.type === 'image' && block.image) {
    return serializeImageSource(block.image);
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

      return {
        role: m.role as 'user' | 'assistant',
        content: blocks as Anthropic.MessageParam['content'],
      };
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
