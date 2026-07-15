import { describe, it, expect } from 'vitest';
import {
  serializeMessagesForApi,
  responseContentToBlocks,
} from '../src/agent/message-serializer.js';
import { Message } from '../src/pkg/types.js';

describe('Message Serializer', () => {
  it('serializes plain string messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello', timestamp: 1 },
      { role: 'assistant', content: 'hi there', timestamp: 2 },
    ];

    const result = serializeMessagesForApi(messages);
    expect(result).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  it('skips system messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'system prompt', timestamp: 1 },
      { role: 'user', content: 'hello', timestamp: 2 },
    ];

    const result = serializeMessagesForApi(messages);
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('user');
  });

  it('serializes assistant tool_use blocks', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text' as const, text: 'Let me read that file.' },
          {
            type: 'tool_use',
            toolUse: { id: 'toolu_01', name: 'Read', input: { path: '/tmp/a.txt' } },
          },
        ],
        timestamp: 1,
      },
    ];

    const result = serializeMessagesForApi(messages);
    expect(result[0]?.content).toEqual([
      { type: 'text' as const, text: 'Let me read that file.' },
      { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { path: '/tmp/a.txt' } },
    ]);
  });

  it('serializes user tool_result blocks with tool_use_id', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'toolu_01',
            toolResult: { content: [{ type: 'text' as const, text: 'file contents' }] },
          },
        ],
        timestamp: 1,
      },
    ];

    const result = serializeMessagesForApi(messages);
    expect(result[0]?.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_01',
        content: 'file contents',
        is_error: false,
      },
    ]);
  });

  it('marks error tool results', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'toolu_02',
            toolResult: {
              content: [{ type: 'text' as const, text: 'Permission denied' }],
              isError: true,
            },
          },
        ],
        timestamp: 1,
      },
    ];

    const result = serializeMessagesForApi(messages);
    const block = (result[0]?.content as Array<{ is_error?: boolean }>)[0];
    expect(block?.is_error).toBe(true);
  });

  it('preserves multi-turn tool conversation order', () => {
    const messages: Message[] = [
      { role: 'user', content: 'read /tmp/a.txt', timestamp: 1 },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', toolUse: { id: 'toolu_01', name: 'Read', input: { path: '/tmp/a.txt' } } },
        ],
        timestamp: 2,
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'toolu_01',
            toolResult: { content: [{ type: 'text' as const, text: 'hello' }] },
          },
        ],
        timestamp: 3,
      },
    ];

    const result = serializeMessagesForApi(messages);
    expect(result).toHaveLength(3);
    expect(result[1]?.role).toBe('assistant');
    expect(result[2]?.role).toBe('user');
    expect(result[2]?.content).not.toEqual('...');
  });

  it('responseContentToBlocks converts model output', () => {
    const blocks = responseContentToBlocks([
      { type: 'text' as const, text: 'Running command.' },
      { type: 'tool_use', id: 'toolu_03', name: 'Bash', input: { command: 'pwd' } },
    ]);

    expect(blocks).toEqual([
      { type: 'text' as const, text: 'Running command.' },
      { type: 'tool_use', toolUse: { id: 'toolu_03', name: 'Bash', input: { command: 'pwd' } } },
    ]);
  });
});
