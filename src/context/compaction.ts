/**
 * Compaction Pipeline - 5 layers
 */

import { ModelContext } from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';

export class CompactionPipeline {
  private log: Logger;
  private readonly THRESHOLD = 0.83;

  constructor() {
    this.log = new Logger({ prefix: 'CompactionPipeline' });
  }

  async run(context: ModelContext): Promise<ModelContext> {
    const ratio = context.tokenCount / context.maxTokens;
    if (ratio < this.THRESHOLD) return context;

    this.log.info(`Compaction triggered at ${(ratio * 100).toFixed(1)}%`);
    let result = { ...context };

    if (ratio > 0.83) result = this.budgetReduction(result);
    if (ratio > 0.88) result = this.snip(result);
    if (ratio > 0.93) result = this.microcompact(result);
    if (ratio > 0.96) result = this.contextCollapse(result);
    if (ratio > 0.99) result = await this.autoCompact(result);

    this.log.info(`Compaction: ${context.tokenCount} → ${result.tokenCount} tokens`);
    return result;
  }

  private budgetReduction(ctx: ModelContext): ModelContext {
    return { ...ctx, maxTokens: Math.floor(ctx.maxTokens * 0.7) };
  }

  private snip(ctx: ModelContext): ModelContext {
    const msgs = ctx.messages.slice(-20);
    return { ...ctx, messages: msgs, tokenCount: this.countTokens(ctx) };
  }

  private microcompact(ctx: ModelContext): ModelContext {
    const msgs = ctx.messages.slice(-10);
    return { ...ctx, messages: msgs, tokenCount: this.countTokens(ctx) };
  }

  private contextCollapse(ctx: ModelContext): ModelContext {
    return {
      ...ctx,
      compactBoundaries: [...(ctx.compactBoundaries ?? []), {
        type: 'compact_boundary',
        summary: '[Earlier messages compressed]',
        originalMessageCount: ctx.messages.length,
        timestamp: Date.now(),
      }],
      tokenCount: this.countTokens(ctx),
    };
  }

  private async autoCompact(ctx: ModelContext): Promise<ModelContext> {
    const half = Math.floor(ctx.messages.length / 2);
    return {
      ...ctx,
      messages: [
        { role: 'system', content: `[${half} messages summarized]`, timestamp: Date.now() },
        ...ctx.messages.slice(half),
      ],
      tokenCount: this.countTokens(ctx),
    };
  }

  private countTokens(ctx: ModelContext): number {
    let total = Math.ceil(ctx.systemPrompt.length / 4);
    for (const m of ctx.messages) {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      total += Math.ceil(c.length / 4);
    }
    return total;
  }
}
