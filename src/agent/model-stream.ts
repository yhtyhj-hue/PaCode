/**
 * Anthropic stream consumer — yields text deltas as they arrive
 */

import { StopReason, ToolCall } from '../pkg/types.js';

export type ModelContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export type ModelStreamEvent =
  | { type: 'content_block_delta'; delta: { index: number; text: string } }
  | {
      type: 'model_complete';
      stopReason: StopReason;
      content: ModelContentBlock[];
      toolCalls: ToolCall[];
      usage: { input_tokens: number; output_tokens: number } | null;
    };

/** Anthropic SDK stream event 子集 */
export interface StreamEventLike {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type: string; text?: string; stop_reason?: string; partial_json?: string };
  message?: { usage?: { input_tokens: number; output_tokens: number } };
}

/**
 * 消费 Anthropic 流式事件，实时 yield text_delta，最后 yield model_complete
 */
export async function* consumeModelStream(
  stream: AsyncIterable<StreamEventLike>
): AsyncGenerator<ModelStreamEvent> {
  let stopReason: StopReason = 'end_turn';
  let usage: { input_tokens: number; output_tokens: number } | null = null;
  const content: ModelContentBlock[] = [];
  const toolCalls: ToolCall[] = [];

  for await (const event of stream) {
    if (event.type === 'message_stop') {
      stopReason = 'end_turn';
    }

    if (event.type === 'content_block_start' && event.content_block) {
      if (event.content_block.type === 'text') {
        content.push({ type: 'text', text: '' });
      } else if (event.content_block.type === 'tool_use') {
        content.push({
          type: 'tool_use',
          id: event.content_block.id ?? '',
          name: event.content_block.name ?? '',
          input: {},
        });
      }
    }

    if (event.type === 'content_block_delta' && event.delta) {
      const last = content[content.length - 1];
      if (event.delta.type === 'text_delta' && last?.type === 'text') {
        last.text += event.delta.text ?? '';
        yield {
          type: 'content_block_delta',
          delta: { index: event.index ?? 0, text: event.delta.text ?? '' },
        };
      }
      if (event.delta.type === 'input_json_delta' && last?.type === 'tool_use') {
        try {
          Object.assign(last.input, JSON.parse(event.delta.partial_json ?? '{}'));
        } catch {
          /* partial JSON */
        }
      }
    }

    if (event.type === 'message_delta' && event.delta?.stop_reason) {
      const reason = event.delta.stop_reason;
      if (reason === 'tool_use') stopReason = 'tool_use';
      else if (reason === 'end_turn') stopReason = 'end_turn';
      else if (reason === 'max_tokens') stopReason = 'max_tokens';
    }

    if (event.type === 'message_start' && event.message?.usage) {
      usage = {
        input_tokens: event.message.usage.input_tokens,
        output_tokens: event.message.usage.output_tokens,
      };
    }
  }

  for (const block of content) {
    if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, input: block.input });
    }
  }

  yield { type: 'model_complete', stopReason, content, toolCalls, usage };
}
