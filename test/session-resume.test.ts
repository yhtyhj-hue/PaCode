import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionResume, resetSessionResume, getSessionResume } from '../src/cli/resume.js';
import { SessionManager } from '../src/session/manager.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('Session Resume', () => {
  let sessionsDir: string;

  beforeEach(() => {
    sessionsDir = join(tmpdir(), `resume-${Date.now()}`);
    mkdirSync(sessionsDir, { recursive: true });
    resetSessionResume();
  });

  afterEach(() => {
    if (existsSync(sessionsDir)) rmSync(sessionsDir, { recursive: true, force: true });
  });

  it('lists and loads saved sessions', () => {
    const manager = new SessionManager(sessionsDir);
    const session = manager.createSession({ mode: PermissionMode.DEFAULT });
    manager.addMessage(session, { role: 'user', content: 'hello', timestamp: 1 });
    manager.saveSession(session);

    const resume = new SessionResume(sessionsDir);
    const list = resume.list();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.id).toBe(session.sessionId);

    const loaded = resume.load(session.sessionId);
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.messages[0]?.content).toBe('hello');
  });

  it('getLatest returns most recently modified session', () => {
    writeFileSync(
      join(sessionsDir, 'session_old.json'),
      JSON.stringify({
        sessionId: 'old',
        messages: [{ role: 'user', content: 'a', timestamp: 1 }],
        toolCallHistory: [],
        maxOutputTokensRecoveryCount: 0,
        mode: PermissionMode.DEFAULT,
        hooks: { hooks: {} },
        compactionHistory: [],
      })
    );

    const manager = new SessionManager(sessionsDir);
    const newer = manager.createSession({ mode: PermissionMode.ACCEPT_EDITS });
    manager.addMessage(newer, { role: 'user', content: 'b', timestamp: 2 });
    manager.saveSession(newer);

    const resume = new SessionResume(sessionsDir);
    expect(resume.getLatest()?.id).toBe(newer.sessionId);
  });

  it('SessionManager.restoreSession sets current session', () => {
    const manager = new SessionManager(sessionsDir);
    const saved = manager.createSession({ mode: PermissionMode.PLAN });
    manager.saveSession(saved);

    const resume = new SessionResume(sessionsDir);
    const loaded = resume.load(saved.sessionId);
    expect(loaded).toBeTruthy();

    const restored = manager.restoreSession(loaded!);
    expect(manager.getCurrentSession()?.sessionId).toBe(restored.sessionId);
    expect(manager.getCurrentSession()?.mode).toBe(PermissionMode.PLAN);
  });

  it('loadFromFile reads session path directly', () => {
    const manager = new SessionManager(sessionsDir);
    const saved = manager.createSession({ mode: PermissionMode.DEFAULT });
    manager.saveSession(saved);

    const resume = new SessionResume(sessionsDir);
    const file = join(sessionsDir, `session_${saved.sessionId}.json`);
    const loaded = resume.loadFromFile(file);
    expect(loaded?.sessionId).toBe(saved.sessionId);
  });

  it('skips corrupt session files in list', () => {
    writeFileSync(join(sessionsDir, 'session_bad.json'), 'not-json');
    const resume = new SessionResume(sessionsDir);
    expect(resume.list()).toEqual([]);
  });

  it('getSessionResume returns singleton', () => {
    resetSessionResume();
    const a = getSessionResume(sessionsDir);
    const b = getSessionResume();
    expect(a).toBe(b);
  });
});
