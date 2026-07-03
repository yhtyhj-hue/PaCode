/**
 * Compaction Pipeline Tests
 */

import { describe, it, expect } from 'vitest';
import { CompactionPipeline } from '../src/context/compaction.js';
import { Message } from '../src/pkg/types.js';

describe('CompactionPipeline', () => {
  const pipeline = new CompactionPipeline();

  it('does not compact when under threshold', async () => {
    const ctx = {
      systemPrompt: 'test',
      messages: [],
      tools: [],
      maxTokens: 100000,
      tokenCount: 10000,
    };
    const result = await pipeline.run(ctx);
    expect(result.tokenCount).toBe(10000);
  });

  it('reduces budget when over 83%', async () => {
    const ctx = {
      systemPrompt: 'test',
      messages: [],
      tools: [],
      maxTokens: 100000,
      tokenCount: 85000,
    };
    const result = await pipeline.run(ctx);
    expect(result.maxTokens).toBeLessThan(100000);
  });

  it('snips messages when over 88%', async () => {
    const messages: Message[] = Array(30)
      .fill(null)
      .map((_, i) => ({
        role: 'user' as const,
        content: `message ${i}`,
        timestamp: Date.now(),
      }));
    const ctx = {
      systemPrompt: 'test',
      messages,
      tools: [],
      maxTokens: 100000,
      tokenCount: 90000,
    };
    const result = await pipeline.run(ctx);
    expect(result.messages.length).toBeLessThan(30);
  });
});
