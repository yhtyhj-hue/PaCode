/**
 * OpenAI chat.completions 流 → ModelStreamEvent（与 Anthropic consumeModelStream 对齐）
 */

import type OpenAI from 'openai';
import { StopReason, type ToolCall } from '../pkg/types.js';
import type { ModelContentBlock, ModelStreamEvent } from './model-stream.js';

type ToolAcc = {
  id: string;
  name: string;
  arguments: string;
};

/**
 * 消费 OpenAI（及兼容端）streaming chat.completions
 */
export async function* consumeOpenAIChatStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
): AsyncGenerator<ModelStreamEvent> {
  let text = '';
  const tools = new Map<number, ToolAcc>();
  let finish: string | null = null;
  let usage: { input_tokens: number; output_tokens: number } | null = null;

  for await (const chunk of stream) {
    const u = chunk.usage;
    if (u) {
      usage = {
        input_tokens: u.prompt_tokens ?? 0,
        output_tokens: u.completion_tokens ?? 0,
      };
    }

    const choice = chunk.choices[0];
    if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;

    const delta = choice.delta;
    if (delta?.content) {
      text += delta.content;
      yield {
        type: 'content_block_delta',
        delta: { index: 0, text: delta.content },
      };
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        let acc = tools.get(idx);
        if (!acc) {
          acc = { id: tc.id ?? `call_${idx}`, name: '', arguments: '' };
          tools.set(idx, acc);
        }
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
      }
    }
  }

  const content: ModelContentBlock[] = [];
  const toolCalls: ToolCall[] = [];

  if (text) {
    content.push({ type: 'text', text });
  }

  for (const acc of [...tools.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])) {
    let input: Record<string, unknown> = {};
    try {
      input = acc.arguments ? (JSON.parse(acc.arguments) as Record<string, unknown>) : {};
    } catch {
      input = { _raw: acc.arguments };
    }
    content.push({
      type: 'tool_use',
      id: acc.id,
      name: acc.name,
      input,
      jsonParts: acc.arguments,
    });
    toolCalls.push({ id: acc.id, name: acc.name, input });
  }

  let stopReason: StopReason = 'end_turn';
  if (finish === 'tool_calls' || toolCalls.length > 0) stopReason = 'tool_use';
  else if (finish === 'length') stopReason = 'max_tokens';

  yield {
    type: 'model_complete',
    stopReason,
    content,
    toolCalls,
    usage,
  };
}
