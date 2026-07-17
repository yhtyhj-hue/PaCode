/**
 * TUI /resume list + confirm restore
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionMode, type SessionState } from '../src/pkg/types.js';
import { SessionResume, resetSessionResume } from '../src/cli/resume.js';
import {
  applySessionState,
  formatResumeListLines,
  formatResumeSuccess,
  loadResumeSession,
} from '../src/cli/resume-display.js';
import { handleTuiSlash, TUI_SLASH_HELP } from '../src/cli/tui/slash.js';
import type { OutputStyle } from '../src/cli/output-styles.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'pacode-tui-resume-'));
  resetSessionResume();
});
afterEach(() => {
  resetSessionResume();
  rmSync(workDir, { recursive: true, force: true });
});

function writeSession(id: string, messages: unknown[]): void {
  const dir = join(workDir, '.paude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `session_${id}.json`),
    JSON.stringify({
      sessionId: id,
      mode: PermissionMode.ACCEPT_EDITS,
      hooks: { hooks: {} },
      compactionHistory: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      messages,
    })
  );
}

describe('resume-display', () => {
  it('lists and loads sessions', () => {
    writeSession('abc', [{ role: 'user', content: 'hi', timestamp: 1 }]);
    const resume = new SessionResume(join(workDir, '.paude', 'sessions'));
    const lines = formatResumeListLines(resume);
    expect(lines.some((l) => l.includes('abc'))).toBe(true);
    const loaded = loadResumeSession('abc', resume);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.state.messages).toHaveLength(1);
      expect(formatResumeSuccess(loaded.state)).toContain('abc');
    }
  });

  it('applySessionState mutates target in place', () => {
    writeSession('xyz', [
      { role: 'user', content: 'a', timestamp: 1 },
      { role: 'assistant', content: 'b', timestamp: 2 },
    ]);
    const resume = new SessionResume(join(workDir, '.paude', 'sessions'));
    const loaded = loadResumeSession('xyz', resume);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const live: SessionState = {
      sessionId: 'live',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    };
    applySessionState(live, loaded.state);
    expect(live.sessionId).toBe('xyz');
    expect(live.messages).toHaveLength(2);
    expect(live.mode).toBe(PermissionMode.ACCEPT_EDITS);
  });
});

describe('TUI /resume', () => {
  it('help lists resume; list and restore with confirm', async () => {
    expect(TUI_SLASH_HELP).toMatch(/resume/);
    writeSession('sid1', [{ role: 'user', content: 'hi', timestamp: 1 }]);
    const resume = new SessionResume(join(workDir, '.paude', 'sessions'));

    const lines: string[] = [];
    let confirm = true;
    const ctl = {
      appendSystem: (l: string) => lines.push(l),
      appendError: (l: string) => lines.push(`ERR:${l}`),
      setMode: vi.fn(),
      askConfirm: async () => confirm,
      askText: async () => '',
      appendUser: () => undefined,
      appendTool: () => undefined,
      appendAssistantDelta: () => undefined,
      setBusy: () => undefined,
      setStatus: () => undefined,
      requestInterrupt: () => undefined,
    };

    const session: SessionState = {
      sessionId: 'live',
      messages: [{ role: 'user', content: 'old', timestamp: 0 }],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    };

    const makeCtx = () => ({
      ctl: ctl as never,
      session,
      model: 'm',
      apiKeyPresent: true,
      tokenUsage: { input: 0, output: 0 },
      outputStyle: 'default' as OutputStyle,
      setOutputStyle: () => undefined,
      resume,
    });

    lines.length = 0;
    expect(await handleTuiSlash('/resume', makeCtx())).toBe(true);
    expect(lines.some((l) => l.includes('sid1'))).toBe(true);

    lines.length = 0;
    expect(await handleTuiSlash('/resume sid1', makeCtx())).toBe(true);
    expect(session.sessionId).toBe('sid1');
    expect(session.messages).toHaveLength(1);
    expect(ctl.setMode).toHaveBeenCalledWith(PermissionMode.ACCEPT_EDITS);
    expect(lines.some((l) => /Resumed session sid1/.test(l))).toBe(true);

    confirm = false;
    session.sessionId = 'live2';
    session.messages = [];
    lines.length = 0;
    expect(await handleTuiSlash('/resume sid1', makeCtx())).toBe(true);
    expect(lines.some((l) => /cancelled/i.test(l))).toBe(true);
    expect(session.sessionId).toBe('live2');
  });
});
