/**
 * Anthropic MessageParam → OpenAI Chat Completions messages
 */

import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

function contentToText(
  content: string | Anthropic.Messages.ContentBlockParam[] | Anthropic.Messages.ContentBlock[]
): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const b of content) {
    if (b && typeof b === 'object' && 'type' in b) {
      if (b.type === 'text' && 'text' in b) parts.push(String(b.text ?? ''));
      else if (b.type === 'image') parts.push('[image]');
    }
  }
  return parts.join('\n');
}

/**
 * 将 compileMessagesForApi 产出的 Anthropic messages 转为 OpenAI 格式
 * tool_result 拆成 role=tool；assistant tool_use 拆成 tool_calls
 */
export function toOpenAIChatMessages(
  system: string | undefined,
  messages: Anthropic.Messages.MessageParam[]
): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (system?.trim()) {
    out.push({ role: 'system', content: system });
  }

  for (const m of messages) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') {
        out.push({ role: 'user', content: m.content });
        continue;
      }
      const blocks = Array.isArray(m.content) ? m.content : [];
      const toolResults = blocks.filter(
        (b) => b && typeof b === 'object' && 'type' in b && b.type === 'tool_result'
      ) as Anthropic.Messages.ToolResultBlockParam[];
      const other = blocks.filter(
        (b) => !(b && typeof b === 'object' && 'type' in b && b.type === 'tool_result')
      );

      for (const tr of toolResults) {
        out.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content:
            typeof tr.content === 'string'
              ? tr.content
              : contentToText(tr.content as Anthropic.Messages.ContentBlockParam[]),
        });
      }
      if (other.length > 0) {
        out.push({ role: 'user', content: contentToText(other) });
      } else if (toolResults.length === 0) {
        out.push({ role: 'user', content: '' });
      }
      continue;
    }

    if (m.role === 'assistant') {
      if (typeof m.content === 'string') {
        out.push({ role: 'assistant', content: m.content });
        continue;
      }
      const blocks = Array.isArray(m.content) ? m.content : [];
      let text = '';
      const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];
      for (const b of blocks) {
        if (!b || typeof b !== 'object' || !('type' in b)) continue;
        if (b.type === 'text') text += String((b as { text?: string }).text ?? '');
        if (b.type === 'tool_use') {
          const tu = b as Anthropic.Messages.ToolUseBlockParam;
          toolCalls.push({
            id: tu.id,
            type: 'function',
            function: {
              name: tu.name,
              arguments: JSON.stringify(tu.input ?? {}),
            },
          });
        }
      }
      if (toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls,
        });
      } else {
        out.push({ role: 'assistant', content: text });
      }
    }
  }

  return out;
}

export function toOpenAITools(
  tools: Array<{ name: string; description: string; input_schema: unknown }>
): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: (t.input_schema ?? { type: 'object', properties: {} }) as Record<
        string,
        unknown
      >,
    },
  }));
}
