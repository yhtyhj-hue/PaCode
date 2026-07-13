import { describe, it, expect } from 'vitest';
import { compactSession } from '../src/context/session-compactor.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('Session Compactor', () => {
  it('skips when message count <= keepRecent', async () => {
    const session = {
      sessionId: 's1',
      messages: [
        { role: 'user' as const, content: 'a', timestamp: 1 },
        { role: 'assistant' as const, content: 'b', timestamp: 2 },
      ],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    };

    const result = await compactSession(session, {
      summarizeFn: async () => 'should not run',
      keepRecent: 4,
    });

    expect(result.beforeCount).toBe(2);
    expect(result.afterCount).toBe(2);
    expect(result.summary).toBe('');
  });

  it('summarizes older messages and keeps recent ones', async () => {
    const session = {
      sessionId: 's2',
      messages: [
        { role: 'user' as const, content: 'old question 1', timestamp: 1 },
        { role: 'assistant' as const, content: 'old answer 1', timestamp: 2 },
        { role: 'user' as const, content: 'old question 2', timestamp: 3 },
        { role: 'assistant' as const, content: 'old answer 2', timestamp: 4 },
        { role: 'user' as const, content: 'recent 1', timestamp: 5 },
        { role: 'assistant' as const, content: 'recent 2', timestamp: 6 },
      ],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    };

    const result = await compactSession(session, {
      keepRecent: 2,
      summarizeFn: async () => '- discussed old topics\n- decided X',
    });

    expect(result.beforeCount).toBe(6);
    expect(result.afterCount).toBe(3);
    expect(result.session.messages[0]?.content).toContain('<compact>');
    expect(result.session.messages[0]?.content).toContain('discussed old topics');
    expect(result.session.messages[1]?.content).toBe('recent 1');
    expect(result.session.compactionHistory).toHaveLength(1);
  });
});
