import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../src/session/manager.js';
import { QueryEngine } from '../src/agent/engine.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { PermissionMode } from '../src/pkg/types.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('REPL Integration', () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = join(tmpdir(), 'pacode-repl-' + Date.now());
  });

  it('QueryEngine shares tool registry with injected session manager', async () => {
    const sessionManager = new SessionManager(sessionDir);
    const toolRegistry = new ToolRegistry();
    toolRegistry.register({
      name: 'Ping',
      description: 'ping',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.DEFAULT,
      async execute() {
        return { content: [{ type: 'text', text: 'pong' }] };
      },
    });

    const engine = new QueryEngine({
      apiKey: 'test-key',
      sessionManager,
      toolRegistry,
      permissionPrompt: async () => true,
    });

    const session = sessionManager.createSession({ mode: PermissionMode.DEFAULT });
    const result = await engine.executeToolCall(
      { id: 'r1', name: 'Ping', input: {} },
      session
    );

    expect(result.content[0]?.text).toBe('pong');
    expect(engine.getToolRegistry()).toBe(toolRegistry);
  });

  it('session persists across REPL operations', () => {
    const sessionManager = new SessionManager(join(sessionDir, 'persist'));
    const s1 = sessionManager.createSession({ mode: PermissionMode.ACCEPT_EDITS });
    sessionManager.addMessage(s1, { role: 'user', content: 'hi', timestamp: 0 });
    sessionManager.saveSession(s1);

    const s2 = sessionManager.loadSession(s1.sessionId);
    expect(s2).toBeTruthy();
    expect(s2?.mode).toBe(PermissionMode.ACCEPT_EDITS);
    expect(s2?.messages).toHaveLength(1);
  });

  it('handles all permission modes in session state', () => {
    const sessionManager = new SessionManager(join(sessionDir, 'modes'));
    const modes = [
      PermissionMode.PLAN,
      PermissionMode.DEFAULT,
      PermissionMode.ACCEPT_EDITS,
      PermissionMode.AUTO,
      PermissionMode.DONT_ASK,
      PermissionMode.BYPASS,
      PermissionMode.BUBBLE,
    ];
    for (const mode of modes) {
      const s = sessionManager.createSession({ mode });
      expect(s.mode).toBe(mode);
    }
  });
});
