/**
 * Mock Anthropic client for Engine integration tests
 */

import type Anthropic from '@anthropic-ai/sdk';
import { StreamEventLike } from '../../src/agent/model-stream.js';
import { StopReason } from '../../src/pkg/types.js';

export interface MockStreamScenario {
  events: StreamEventLike[];
  usage?: { input_tokens: number; output_tokens: number };
}

/** 构建可 async-iterate 的 mock stream + finalMessage */
export function createMockMessageStream(scenario: MockStreamScenario) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of scenario.events) {
        yield event;
      }
    },
    finalMessage: async () => ({
      id: 'msg_mock',
      type: 'message' as const,
      role: 'assistant' as const,
      content: [],
      model: 'mock',
      stop_reason: inferStopReason(scenario.events),
      usage: scenario.usage ?? { input_tokens: 12, output_tokens: 8 },
    }),
  };
}

function inferStopReason(events: StreamEventLike[]): StopReason {
  for (const event of events) {
    const reason = event.delta?.stop_reason;
    if (reason === 'tool_use') return 'tool_use';
    if (reason === 'max_tokens') return 'max_tokens';
  }
  return 'end_turn';
}

/** 按调用顺序返回不同 stream 场景；可选捕获 stream 参数 */
export function createMockAnthropicClient(
  scenarios: MockStreamScenario[],
  onStream?: (params: Record<string, unknown>, callIndex: number) => void
): Anthropic {
  let callIndex = 0;

  return {
    messages: {
      stream: (params: Record<string, unknown>) => {
        onStream?.(params, callIndex);
        const scenario = scenarios[callIndex] ?? scenarios[scenarios.length - 1]!;
        callIndex++;
        return createMockMessageStream(scenario);
      },
    },
  } as unknown as Anthropic;
}

/** end_turn 文本流场景 */
export function textEndTurnScenario(text: string, usage?: MockStreamScenario['usage']): MockStreamScenario {
  return {
    events: [
      { type: 'content_block_start', content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'message_delta', delta: { type: 'message_delta', stop_reason: 'end_turn' } },
    ],
    usage,
  };
}

/** tool_use 场景 */
export function toolUseScenario(
  toolId: string,
  toolName: string,
  input: Record<string, unknown>
): MockStreamScenario {
  return {
    events: [
      {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: toolId, name: toolName },
      },
      {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
      },
      { type: 'message_delta', delta: { type: 'message_delta', stop_reason: 'tool_use' } },
    ],
  };
}

/** max_tokens 场景 */
export function maxTokensScenario(): MockStreamScenario {
  return {
    events: [{ type: 'message_delta', delta: { type: 'message_delta', stop_reason: 'max_tokens' } }],
  };
}
