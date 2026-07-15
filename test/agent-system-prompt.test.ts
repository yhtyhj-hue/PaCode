/**
 * Default agent system prompt tests
 */

import { describe, it, expect } from 'vitest';
import { getDefaultAgentSystemPrompt } from '../src/agent/system-prompt.js';
import { ContextAssembler } from '../src/context/assembler.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('getDefaultAgentSystemPrompt', () => {
  it('requires tool use and forbids fake execution', () => {
    const prompt = getDefaultAgentSystemPrompt({ cwd: '/tmp/proj' });
    expect(prompt).toContain('/tmp/proj');
    expect(prompt).toContain('Tool-first');
    expect(prompt).toContain('No fake execution');
    expect(prompt).toContain('项目检查');
  });
});

describe('ContextAssembler default prompt', () => {
  it('includes default agent prompt when none provided', async () => {
    const assembler = new ContextAssembler();
    const context = await assembler.assemble({
      sessionId: 's1',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    });

    expect(context.systemPrompt).toContain('PaCode');
    expect(context.systemPrompt).toContain('No fake execution');
  });

  it('merges custom systemPrompt with default agent rules', async () => {
    const assembler = new ContextAssembler();
    const context = await assembler.assemble(
      {
        sessionId: 's1',
        messages: [],
        toolCallHistory: [],
        maxOutputTokensRecoveryCount: 0,
        mode: PermissionMode.DEFAULT,
        hooks: { hooks: {} },
        compactionHistory: [],
      },
      { systemPrompt: 'Custom only prompt' }
    );

    expect(context.systemPrompt).toContain('Custom only prompt');
    expect(context.systemPrompt).toContain('No fake execution');
  });
});
