import { describe, it, expect } from 'vitest';
import { SessionManager } from '../src/session/manager.js';
import { PermissionMode } from '../src/pkg/types.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('REPL Integration', () => {
  it('session manager works with REPL', () => {
    const sessionManager = new SessionManager(join(tmpdir(), 'pacode-repl-' + Date.now()));
    const session = sessionManager.createSession({ mode: PermissionMode.DEFAULT });
    sessionManager.addMessage(session, {
      role: 'user',
      content: 'test',
      timestamp: Date.now(),
    });
    expect(session.messages.length).toBe(1);
  });

  it('session persists across REPL operations', () => {
    const sessionManager = new SessionManager(join(tmpdir(), 'pacode-repl-persist-' + Date.now()));
    const s1 = sessionManager.createSession({ mode: PermissionMode.ACCEPT_EDITS });
    sessionManager.addMessage(s1, { role: 'user', content: 'hi', timestamp: 0 });
    sessionManager.saveSession(s1);

    const s2 = sessionManager.loadSession(s1.sessionId);
    expect(s2).toBeTruthy();
    expect(s2?.mode).toBe(PermissionMode.ACCEPT_EDITS);
  });

  it('handles all permission modes', () => {
    const sessionManager = new SessionManager(join(tmpdir(), 'pacode-repl-modes-' + Date.now()));
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
