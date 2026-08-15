/**
 * Default agent system prompt tests
 */

import { describe, it, expect } from 'vitest';
import { getDefaultAgentSystemPrompt } from '../src/agent/system-prompt.js';
import { ContextAssembler } from '../src/context/assembler.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('getDefaultAgentSystemPrompt', () => {
  it('requires tool use and forbids fake execution', () => {
    // 传 /tmp —— 必然非 git,prompt 应同时含 cwd 警告
    const prompt = getDefaultAgentSystemPrompt({ cwd: '/tmp' });
    expect(prompt).toContain('/tmp');
    expect(prompt).toContain('Tool-first');
    expect(prompt).toContain('No fake execution');
    expect(prompt).toContain('项目检查');
  });

  it('warns when cwd is not a git repository', () => {
    const prompt = getDefaultAgentSystemPrompt({ cwd: '/tmp' });
    expect(prompt).toMatch(/not (a |inside a )?git (working tree|repository)/i);
    expect(prompt).toContain('Do not invoke');
  });

  it('omits the git warning when cwd is inside a git repo', () => {
    // 测试 cwd(本仓库)就是 git repo
    const prompt = getDefaultAgentSystemPrompt({ cwd: process.cwd() });
    expect(prompt).not.toMatch(/not (a |inside a )?git working tree/i);
    expect(prompt).not.toContain('Do not invoke `git status`');
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
