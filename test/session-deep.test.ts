/**
 * Session Manager Deep Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/session/manager.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

describe('SessionManager - Deep Tests', () => {
  let testDir: string;
  let manager: SessionManager;

  beforeEach(() => {
    testDir = join(tmpdir(), 'pacode-session-test-' + Date.now() + '-' + Math.random());
    manager = new SessionManager(testDir);
  });

  describe('Session Creation', () => {
    it('generates unique session IDs', () => {
      const s1 = manager.createSession();
      const s2 = manager.createSession();
      expect(s1.sessionId).not.toBe(s2.sessionId);
    });

    it('initializes empty state', () => {
      const s = manager.createSession();
      expect(s.messages).toEqual([]);
      expect(s.toolCallHistory).toEqual([]);
      expect(s.compactionHistory).toEqual([]);
    });
  });

  describe('Messages', () => {
    it('adds messages with timestamp', () => {
      const s = manager.createSession();
      manager.addMessage(s, { role: 'user', content: 'hi', timestamp: 0 });
      expect(s.messages.length).toBe(1);
      expect(s.messages[0]?.timestamp).toBeGreaterThan(0);
    });

    it('preserves order', () => {
      const s = manager.createSession();
      manager.addMessage(s, { role: 'user', content: 'a', timestamp: 0 });
      manager.addMessage(s, { role: 'assistant', content: 'b', timestamp: 0 });
      expect(s.messages[0]?.content).toBe('a');
      expect(s.messages[1]?.content).toBe('b');
    });

    it('getMessages returns copy', () => {
      const s = manager.createSession();
      manager.addMessage(s, { role: 'user', content: 'a', timestamp: 0 });
      const messages = manager.getMessages(s);
      messages.push({ role: 'user', content: 'b', timestamp: 0 });
      expect(s.messages.length).toBe(1);
    });
  });

  describe('Tool Calls', () => {
    it('tracks tool call history', () => {
      const s = manager.createSession();
      manager.addToolCall(s, { id: '1', name: 'Bash', input: { command: 'ls' } });
      expect(s.toolCallHistory.length).toBe(1);
    });
  });

  describe('Compaction', () => {
    it('tracks compaction records', () => {
      const s = manager.createSession();
      manager.addCompactionRecord(s, {
        type: 1 as any,
        beforeTokens: 1000,
        afterTokens: 500,
      });
      expect(s.compactionHistory.length).toBe(1);
    });

    it('increments recovery count', () => {
      const s = manager.createSession();
      manager.incrementRecoveryCount(s);
      manager.incrementRecoveryCount(s);
      expect(s.maxOutputTokensRecoveryCount).toBe(2);
    });
  });

  describe('Persistence', () => {
    it('saves session to file', () => {
      const s = manager.createSession();
      manager.addMessage(s, { role: 'user', content: 'test', timestamp: 0 });
      manager.saveSession(s);
      const f = join(testDir, 'session_' + s.sessionId + '.json');
      expect(existsSync(f)).toBe(true);
    });

    it('loads session from file', () => {
      const s1 = manager.createSession();
      manager.addMessage(s1, { role: 'user', content: 'hello', timestamp: 0 });
      manager.saveSession(s1);

      const s2 = manager.loadSession(s1.sessionId);
      expect(s2).toBeTruthy();
      expect(s2?.messages.length).toBe(1);
    });

    it('returns null for non-existent session', () => {
      expect(manager.loadSession('non-existent-id')).toBeNull();
    });
  });

  describe('Project ID', () => {
    it('generates consistent ID', () => {
      const id1 = SessionManager.generateProjectId('/path/to/project');
      const id2 = SessionManager.generateProjectId('/path/to/project');
      expect(id1).toBe(id2);
    });

    it('generates different IDs for different paths', () => {
      const id1 = SessionManager.generateProjectId('/a');
      const id2 = SessionManager.generateProjectId('/b');
      expect(id1).not.toBe(id2);
    });

    it('generates 12-char ID', () => {
      const id = SessionManager.generateProjectId('/anywhere');
      expect(id.length).toBe(12);
    });
  });
});
