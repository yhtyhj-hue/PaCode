/**
 * REPL slash command tests (C3)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { REPL } from '../src/cli/repl.js';
import { SessionManager } from '../src/session/manager.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { HookRegistry } from '../src/hooks/registry.js';
import { PermissionMode } from '../src/pkg/types.js';

vi.mock('../src/context/session-compactor.js', () => ({
  compactSession: vi.fn(async (session: { messages: unknown[] }) => ({
    session: { ...session, messages: session.messages.slice(0, 2) },
    beforeCount: session.messages.length,
    afterCount: 2,
    summary: 'condensed summary',
  })),
}));

import { compactSession } from '../src/context/session-compactor.js';

function createTestRepl(sessionDir: string, mode = PermissionMode.DEFAULT): REPL {
  return new REPL({
    apiKey: 'test-key',
    model: 'claude-sonnet-4-0',
    mode,
    provider: { name: 'test', apiKey: 'test-key' },
    sessionManager: new SessionManager(sessionDir),
    toolRegistry: new ToolRegistry(),
    hookRegistry: new HookRegistry(),
  });
}

function seedMessages(repl: REPL, count: number): void {
  const session = repl['sessionManager'].createSession({ mode: PermissionMode.DEFAULT });
  for (let i = 0; i < count; i++) {
    repl['sessionManager'].addMessage(session, {
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message-${i}`,
      timestamp: i,
    });
  }
}

describe('REPL slash commands', () => {
  let sessionDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'pacode-repl-slash-'));
    logSpy = (vi.spyOn(console, 'log').mockImplementation(() => {})) as unknown as ReturnType<typeof vi.spyOn>;
    vi.mocked(compactSession).mockClear();
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(sessionDir, { recursive: true, force: true });
  });

  describe('/mode', () => {
    it('changes permission mode', async () => {
      const repl = createTestRepl(sessionDir);
      await repl.dispatchSlashCommand('/mode acceptEdits');
      expect(repl.getPermissionMode()).toBe(PermissionMode.ACCEPT_EDITS);
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes('acceptEdits'))).toBe(true);
    });

    it('prints current mode when no arg', async () => {
      const repl = createTestRepl(sessionDir, PermissionMode.PLAN);
      await repl.dispatchSlashCommand('/mode');
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes(PermissionMode.PLAN))).toBe(true);
    });

    it('rejects unknown mode', async () => {
      const repl = createTestRepl(sessionDir);
      await repl.dispatchSlashCommand('/mode bogus');
      expect(repl.getPermissionMode()).toBe(PermissionMode.DEFAULT);
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Unknown mode'))).toBe(true);
    });
  });

  describe('/compact', () => {
    it('warns when too few messages', async () => {
      const repl = createTestRepl(sessionDir);
      seedMessages(repl, 3);
      await repl.dispatchSlashCommand('/compact');
      expect(compactSession).not.toHaveBeenCalled();
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Not enough messages'))).toBe(
        true
      );
    });

    it('compacts when enough messages', async () => {
      const repl = createTestRepl(sessionDir);
      seedMessages(repl, 6);
      await repl.dispatchSlashCommand('/compact keep todos');
      expect(compactSession).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Compacted 6 → 2'))).toBe(true);
    });
  });

  describe('plugin commands', () => {
    it('peek expands $ARGUMENTS in plugin prompt', () => {
      const repl = createTestRepl(sessionDir);
      repl.registerPluginCommand({
        name: 'review',
        description: 'Code review',
        prompt: 'Review file: $ARGUMENTS',
        pluginName: 'demo',
      });

      const peek = repl.peekSlashCommand('/review src/agent/engine.ts');
      expect(peek).toEqual({
        kind: 'plugin',
        name: 'review',
        prompt: 'Review file: src/agent/engine.ts',
      });
    });

    it('builtin commands fall through to peek kind builtin', () => {
      const repl = createTestRepl(sessionDir);
      expect(repl.peekSlashCommand('/help')).toEqual({ kind: 'builtin', command: '/help' });
    });
  });

  describe('/exit', () => {
  it('sets exit flag', async () => {
    const repl = createTestRepl(sessionDir);
    await repl.dispatchSlashCommand('/exit');
    expect(repl.isExitRequested()).toBe(true);
  });

  it('help and status commands print output', async () => {
    const repl = createTestRepl(sessionDir);
    await repl.dispatchSlashCommand('/help');
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Available Commands'))).toBe(true);

    await repl.dispatchSlashCommand('/status');
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Session Status'))).toBe(true);

    await repl.dispatchSlashCommand('/context');
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Context Usage'))).toBe(true);
  });
});
});
