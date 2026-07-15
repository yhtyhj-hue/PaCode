/**
 * Compaction Pipeline - 5 layers
 */

import { ModelContext, Message } from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';
import Anthropic from '@anthropic-ai/sdk';
import {
  countContextTokens,
  snipMessages,
  microcompactMessages,
  collapseOlderMessages,
  formatMessagesForSummary,
} from './compaction-utils.js';

const AUTO_COMPACT_PROMPT = `Summarize the conversation below for context continuity.
Preserve: user goals, decisions, file paths, errors, and unfinished tasks.
Use concise bullet points. Do not invent facts.`;

export interface CompactionPipelineOptions {
  threshold?: number;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** 测试注入，跳过 LLM */
  summarizeFn?: (prompt: string) => Promise<string>;
}

export class CompactionPipeline {
  private log: Logger;
  private readonly threshold: number;
  private summarizeFn?: (prompt: string) => Promise<string>;
  private llmOptions: { apiKey?: string; baseUrl?: string; model?: string };

  constructor(options: CompactionPipelineOptions = {}) {
    this.log = new Logger({ prefix: 'CompactionPipeline' });
    this.threshold = options.threshold ?? 0.83;
    this.summarizeFn = options.summarizeFn;
    this.llmOptions = {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
    };
  }

  async run(context: ModelContext): Promise<ModelContext> {
    const initialRatio = context.tokenCount / context.maxTokens;
    if (initialRatio < this.threshold) return context;

    this.log.info(`Compaction triggered at ${(initialRatio * 100).toFixed(1)}%`);
    let result = { ...context };

    // 用初始 ratio 决定启用哪些层，避免 snip 后 token 重算导致高层被跳过
    if (initialRatio > 0.83) {
      result = this.budgetReduction(result);
    }
    if (initialRatio > 0.88) {
      result = this.snip(result);
    }
    if (initialRatio > 0.93) {
      result = this.microcompact(result);
    }
    if (initialRatio > 0.96) {
      result = this.contextCollapse(result);
    }
    if (initialRatio > 0.99) {
      result = await this.autoCompact(result);
    }

    this.log.info(`Compaction: ${context.tokenCount} → ${result.tokenCount} tokens`);
    return result;
  }

  private budgetReduction(ctx: ModelContext): ModelContext {
    return { ...ctx, maxTokens: Math.floor(ctx.maxTokens * 0.7) };
  }

  private snip(ctx: ModelContext): ModelContext {
    const messages = snipMessages(ctx.messages, 20);
    return {
      ...ctx,
      messages,
      tokenCount: countContextTokens(ctx.systemPrompt, messages),
    };
  }

  private microcompact(ctx: ModelContext): ModelContext {
    const messages = microcompactMessages(ctx.messages, 10);
    return {
      ...ctx,
      messages,
      tokenCount: countContextTokens(ctx.systemPrompt, messages),
    };
  }

  /** L4：旧消息投影为 <context-collapse> 摘要块 */
  private contextCollapse(ctx: ModelContext): ModelContext {
    const messages = collapseOlderMessages(ctx.messages, 4);
    return {
      ...ctx,
      messages,
      compactBoundaries: [
        ...(ctx.compactBoundaries ?? []),
        {
          type: 'compact_boundary',
          summary: '[Earlier messages collapsed]',
          originalMessageCount: ctx.messages.length,
          timestamp: Date.now(),
        },
      ],
      tokenCount: countContextTokens(ctx.systemPrompt, messages),
    };
  }

  /** L5：LLM 摘要前半段消息（或注入 summarizeFn） */
  private async autoCompact(ctx: ModelContext): Promise<ModelContext> {
    const half = Math.floor(ctx.messages.length / 2);
    if (half <= 0) return ctx;

    const toSummarize = ctx.messages.slice(0, half);
    const recent = ctx.messages.slice(half);
    const transcript = formatMessagesForSummary(toSummarize);
    const prompt = `${AUTO_COMPACT_PROMPT}\n\n${transcript}`;

    let summary: string;
    try {
      summary = await this.summarize(prompt);
    } catch (e) {
      this.log.warn(`autoCompact LLM failed: ${e instanceof Error ? e.message : String(e)}`);
      summary = `[${half} messages — auto summary unavailable]`;
    }

    const messages: Message[] = [
      {
        role: 'user',
        content: `<compact>\n${summary}\n</compact>`,
        timestamp: Date.now(),
      },
      ...recent,
    ];

    return {
      ...ctx,
      messages,
      compactBoundaries: [
        ...(ctx.compactBoundaries ?? []),
        {
          type: 'compact_boundary',
          summary,
          originalMessageCount: ctx.messages.length,
          timestamp: Date.now(),
        },
      ],
      tokenCount: countContextTokens(ctx.systemPrompt, messages),
    };
  }

  private async summarize(prompt: string): Promise<string> {
    if (this.summarizeFn) return this.summarizeFn(prompt);

    const apiKey = this.llmOptions.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    const client = new Anthropic({ apiKey, baseURL: this.llmOptions.baseUrl });
    const response = await client.messages.create({
      model: this.llmOptions.model ?? 'claude-sonnet-4-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content.find((b) => b.type === 'text');
    return block?.type === 'text' ? block.text : '[Compaction produced no summary]';
  }
}
