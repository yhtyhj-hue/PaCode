/**
 * Compaction smart layer tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CompactionPipeline } from '../src/context/compaction.js';
import {
  snipMessages,
  microcompactMessages,
  truncateToolResultsInMessage,
  countContextTokens,
} from '../src/context/compaction-utils.js';
import { Message } from '../src/pkg/types.js';

describe('compaction-utils', () => {
  it('truncates long tool_result text in snip', () => {
    const msg: Message = {
      role: 'user',
      timestamp: 1,
      content: [
        {
          type: 'tool_result',
          toolUseId: 'x',
          toolResult: {
            content: [{ type: 'text', text: 'a'.repeat(5000) }],
          },
        },
      ],
    };

    const truncated = truncateToolResultsInMessage(msg, 100);
    const block = (truncated.content as typeof msg.content)[0]!;
    expect(block.toolResult!.content[0]!.text.length).toBeLessThan(5000);
    expect(block.toolResult!.content[0]!.text).toContain('truncated');
  });

  it('microcompact collapses whitespace in tool results', () => {
    const msg: Message = {
      role: 'user',
      timestamp: 1,
      content: [
        {
          type: 'tool_result',
          toolUseId: 'x',
          toolResult: {
            content: [{ type: 'text', text: 'line1\n\n  line2   line3' }],
          },
        },
      ],
    };

    const compacted = microcompactMessages([msg], 1)[0]!;
    const text = (compacted.content as typeof msg.content)[0]!.toolResult!.content[0]!.text;
    expect(text).not.toContain('\n');
    expect(text).toContain('line1 line2 line3');
  });

  it('snip keeps only last N messages', () => {
    const msgs = Array.from({ length: 25 }, (_, i) => ({
      role: 'user' as const,
      content: `msg ${i}`,
      timestamp: i,
    }));
    expect(snipMessages(msgs, 20)).toHaveLength(20);
  });

  it('countContextTokens includes system and messages', () => {
    const tokens = countContextTokens('system', [
      { role: 'user', content: 'hello', timestamp: 1 },
    ]);
    expect(tokens).toBeGreaterThan(1);
  });
});

describe('CompactionPipeline — token recount after snip', () => {
  let pipeline: CompactionPipeline;

  beforeEach(() => {
    pipeline = new CompactionPipeline();
  });

  it('reduces tokenCount after snip layer', async () => {
    const longMsgs = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'x'.repeat(500),
      timestamp: i,
    }));

    const beforeTokens = countContextTokens('sys', longMsgs);
    const ctx = {
      systemPrompt: 'sys',
      messages: longMsgs,
      tools: [],
      maxTokens: 100000,
      tokenCount: beforeTokens,
    };

    // ratio ~ beforeTokens/100000 — force snip by setting high tokenCount
    const forced = { ...ctx, tokenCount: 90000 };
    const result = await pipeline.run(forced);

    expect(result.messages.length).toBeLessThan(30);
    expect(result.tokenCount).toBeLessThan(forced.tokenCount);
  });

  it('microcompact reduces tokens for large tool outputs', async () => {
    const msg: Message = {
      role: 'user',
      timestamp: 1,
      content: [
        {
          type: 'tool_result',
          toolUseId: 't',
          toolResult: {
            content: [{ type: 'text', text: 'z'.repeat(10000) }],
          },
        },
      ],
    };

    const msgs = Array.from({ length: 15 }, (_, i) => ({
      ...msg,
      timestamp: i,
    }));

    const tokenBefore = countContextTokens('', msgs);
    const compacted = microcompactMessages(msgs, 10);
    const tokenAfter = countContextTokens('', compacted);
    expect(tokenAfter).toBeLessThan(tokenBefore);
  });
});
