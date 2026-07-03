/**
 * Session Manager Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/session/manager.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager('/tmp/pacode-test-sessions');
  });

  it('creates a new session', () => {
    const session = manager.createSession();
    expect(session.sessionId).toBeTruthy();
    expect(session.messages).toEqual([]);
    expect(session.mode).toBe(PermissionMode.DEFAULT);
  });

  it('adds messages to session', () => {
    const session = manager.createSession();
    manager.addMessage(session, { role: 'user', content: 'test', timestamp: Date.now() });
    expect(session.messages.length).toBe(1);
  });

  it('tracks tool calls', () => {
    const session = manager.createSession();
    manager.addToolCall(session, { id: '1', name: 'Bash', input: { command: 'ls' } });
    expect(session.toolCallHistory.length).toBe(1);
  });

  it('changes permission mode', () => {
    const session = manager.createSession();
    manager.setPermissionMode(session, PermissionMode.PLAN);
    expect(session.mode).toBe(PermissionMode.PLAN);
  });

  it('increments recovery count', () => {
    const session = manager.createSession();
    expect(session.maxOutputTokensRecoveryCount).toBe(0);
    manager.incrementRecoveryCount(session);
    expect(session.maxOutputTokensRecoveryCount).toBe(1);
  });
});
