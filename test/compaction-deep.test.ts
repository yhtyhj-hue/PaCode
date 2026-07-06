/**
 * Compaction Pipeline Deep Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CompactionPipeline } from '../src/context/compaction.js';
import { Message } from '../src/pkg/types.js';

describe('CompactionPipeline - Deep Tests', () => {
  let pipeline: CompactionPipeline;

  beforeEach(() => {
    pipeline = new CompactionPipeline();
  });

  describe('Threshold Boundaries', () => {
    it('no compaction at 80%', async () => {
      const ctx = createContext(80000, 100000, []);
      const result = await pipeline.run(ctx);
      expect(result.tokenCount).toBe(80000);
    });

    it('triggers budget reduction at 84%', async () => {
      const ctx = createContext(84000, 100000, []);
      const result = await pipeline.run(ctx);
      expect(result.maxTokens).toBeLessThan(100000);
    });

    it('triggers snip at 90%', async () => {
      const msgs = createMessages(30);
      const ctx = createContext(90000, 100000, msgs);
      const result = await pipeline.run(ctx);
      expect(result.messages.length).toBeLessThan(30);
    });

    it('handles empty message list', async () => {
      const ctx = createContext(99000, 100000, []);
      const result = await pipeline.run(ctx);
      expect(result.messages).toEqual([]);
    });

    it('handles zero token count', async () => {
      const ctx = createContext(0, 100000, []);
      const result = await pipeline.run(ctx);
      expect(result).toBeDefined();
    });
  });

  function createContext(tokenCount: number, maxTokens: number, messages: Message[]) {
    return {
      systemPrompt: 'test',
      messages,
      tools: [],
      maxTokens,
      tokenCount,
    };
  }

  function createMessages(count: number): Message[] {
    return Array(count).fill(null).map((_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'msg ' + i,
      timestamp: Date.now() + i,
    }));
  }
});
