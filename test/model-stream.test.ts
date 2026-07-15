/**
 * Model stream consumer tests
 */

import { describe, it, expect } from 'vitest';
import { consumeModelStream, StreamEventLike } from '../src/agent/model-stream.js';

async function* mockStream(events: StreamEventLike[]) {
  for (const event of events) {
    yield event;
  }
}

describe('consumeModelStream', () => {
  it('yields text deltas before model_complete', async () => {
    const events: StreamEventLike[] = [
      { type: 'content_block_start', content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
      { type: 'message_delta', delta: { type: 'message_delta', stop_reason: 'end_turn' } },
    ];

    const collected: string[] = [];
    let complete: { stopReason: string; content: unknown[] } | undefined;

    for await (const event of consumeModelStream(mockStream(events))) {
      if (event.type === 'content_block_delta') {
        collected.push(event.delta.text);
      } else if (event.type === 'model_complete') {
        complete = event;
      }
    }

    expect(collected).toEqual(['Hello', ' world']);
    expect(complete?.stopReason).toBe('end_turn');
    expect(complete?.content[0]).toEqual({ type: 'text' as const, text: 'Hello world' });
  });

  it('collects tool_use blocks on complete', async () => {
    const events: StreamEventLike[] = [
      {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tu_1', name: 'Read' },
      },
      {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"path":"a.ts"}' },
      },
      { type: 'message_delta', delta: { type: 'message_delta', stop_reason: 'tool_use' } },
    ];

    let complete: Awaited<ReturnType<typeof consumeModelStream>> extends AsyncGenerator<
      infer E
    >
      ? Extract<E, { type: 'model_complete' }>
      : never;

    for await (const event of consumeModelStream(mockStream(events))) {
      if (event.type === 'model_complete') {
        complete = event as typeof complete;
      }
    }

    expect(complete!.stopReason).toBe('tool_use');
    expect(complete!.toolCalls).toHaveLength(1);
    expect(complete!.toolCalls[0]?.name).toBe('Read');
  });

  it('accumulates fragmented input_json_delta before parse', async () => {
    const events: StreamEventLike[] = [
      {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tu_2', name: 'Read' },
      },
      {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"path":' },
      },
      {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '"src/a.ts"}' },
      },
      { type: 'message_delta', delta: { type: 'message_delta', stop_reason: 'tool_use' } },
    ];

    let complete: Awaited<ReturnType<typeof consumeModelStream>> extends AsyncGenerator<
      infer E
    >
      ? Extract<E, { type: 'model_complete' }>
      : never;

    for await (const event of consumeModelStream(mockStream(events))) {
      if (event.type === 'model_complete') {
        complete = event as typeof complete;
      }
    }

    expect(complete!.toolCalls[0]?.input).toEqual({ path: 'src/a.ts' });
  });
});
