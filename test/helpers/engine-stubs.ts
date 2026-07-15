/**
 * Shared stubs for Engine / Subagent tests
 */

import { ContextAssembler } from '../../src/context/assembler.js';
import { CompactionPipeline } from '../../src/context/compaction.js';

export function stubAssembler(): ContextAssembler {
  return {
    async assemble(state: any) {
      return {
        systemPrompt: 'test-system',
        messages: state.messages,
        tools: [],
        maxTokens: 8192,
        tokenCount: 50,
      };
    },
  } as unknown as ContextAssembler;
}

export function passthroughCompaction(): CompactionPipeline {
  return { async run(ctx: any) { return ctx; } } as unknown as CompactionPipeline;
}
