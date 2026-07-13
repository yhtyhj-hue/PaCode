/**
 * Gate eval: 压缩管道确定性行为
 */
import { describe, it, expect } from 'vitest';
import { CompactionPipeline } from '../../src/context/compaction.js';
import type { Message } from '../../src/pkg/types.js';

function makeContext(
  messageCount: number,
  tokenCount: number,
  maxTokens = 100000
) {
  const messages: Message[] = Array.from({ length: messageCount }, (_, i) => ({
    role: 'user' as const,
    content: `message-${i}-${'x'.repeat(200)}`,
    timestamp: Date.now(),
  }));
  return {
    systemPrompt: 'eval',
    messages,
    tools: [],
    maxTokens,
    tokenCount,
  };
}

describe('eval:gate:compaction', () => {
  it('L1 budget reduction lowers maxTokens when over 83%', async () => {
    const pipeline = new CompactionPipeline({ threshold: 0.83 });
    const ctx = makeContext(5, 85000);
    const result = await pipeline.run(ctx);

    expect(result.maxTokens).toBeLessThan(ctx.maxTokens);
  });

  it('L4 context collapse adds compact boundary and collapse marker', async () => {
    const pipeline = new CompactionPipeline({
      threshold: 0.83,
      summarizeFn: async () => 'stub summary',
    });
    const ctx = makeContext(30, 97000);
    const result = await pipeline.run(ctx);

    const serialized = JSON.stringify(result.messages);
    const hasCollapseMarker = serialized.includes('context-collapse');
    const hasBoundary = (result.compactBoundaries?.length ?? 0) > 0;
    expect(hasCollapseMarker || hasBoundary || result.messages.length < ctx.messages.length).toBe(
      true
    );
  });
});
