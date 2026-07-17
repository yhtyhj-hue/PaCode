/**
 * TUI /compact + /mcp shared display
 */
import { describe, it, expect, vi } from 'vitest';
import { PermissionMode, type SessionState } from '../src/pkg/types.js';
import { formatMcpReportLines } from '../src/cli/mcp-display.js';
import { runCompactForDisplay } from '../src/cli/compact-display.js';
import { handleTuiSlash, TUI_SLASH_HELP } from '../src/cli/tui/slash.js';
import type { OutputStyle } from '../src/cli/output-styles.js';

function makeSession(n: number): SessionState {
  return {
    sessionId: 's1',
    messages: Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
      timestamp: i,
    })),
    toolCallHistory: [],
    maxOutputTokensRecoveryCount: 0,
    mode: PermissionMode.DEFAULT,
    hooks: { hooks: {} },
    compactionHistory: [],
  } as SessionState;
}

describe('mcp-display', () => {
  it('formats empty and populated connections', () => {
    expect(formatMcpReportLines([]).some((l) => l.includes('No MCP servers connected'))).toBe(true);
    const lines = formatMcpReportLines([
      { name: 'demo', status: 'connected', tools: [{ name: 't' }] as never },
    ]);
    expect(lines.some((l) => l.includes('demo') && l.includes('connected'))).toBe(true);
  });
});

describe('compact-display', () => {
  it('warns when too few messages', async () => {
    const outcome = await runCompactForDisplay(makeSession(3));
    expect(outcome.ok).toBe(false);
    expect(outcome.lines[0]).toMatch(/Not enough messages/);
  });

  it('compacts via injected compactFn and mutates session', async () => {
    const session = makeSession(6);
    const compactFn = vi.fn(async (s: SessionState) => ({
      session: { ...s, messages: s.messages.slice(0, 2) },
      beforeCount: 6,
      afterCount: 2,
      summary: 'kept goals',
    }));
    const outcome = await runCompactForDisplay(session, { compactFn });
    expect(outcome.ok).toBe(true);
    expect(session.messages).toHaveLength(2);
    expect(outcome.lines[0]).toContain('6 → 2');
  });
});

describe('TUI /compact /mcp', () => {
  it('help lists both; handlers work', async () => {
    expect(TUI_SLASH_HELP).toMatch(/compact/);
    expect(TUI_SLASH_HELP).toMatch(/\/mcp/);

    const lines: string[] = [];
    const ctl = {
      appendSystem: (l: string) => lines.push(l),
      appendError: (l: string) => lines.push(`ERR:${l}`),
      setMode: () => undefined,
      askConfirm: async () => true,
      askText: async () => '',
      appendUser: () => undefined,
      appendTool: () => undefined,
      appendAssistantDelta: () => undefined,
      setBusy: () => undefined,
      setStatus: () => undefined,
      requestInterrupt: () => undefined,
    };
    const session = makeSession(6);
    const compactFn = vi.fn(async (s: SessionState) => ({
      session: { ...s, messages: s.messages.slice(0, 2) },
      beforeCount: 6,
      afterCount: 2,
      summary: 'ok',
    }));
    const ctx = {
      ctl: ctl as never,
      session,
      model: 'm',
      apiKeyPresent: true,
      tokenUsage: { input: 0, output: 0 },
      outputStyle: 'default' as OutputStyle,
      setOutputStyle: () => undefined,
      compactFn,
      mcpConnections: [
        { name: 'remote', status: 'connected' as const, tools: [] },
      ],
    };

    lines.length = 0;
    expect(await handleTuiSlash('/mcp', ctx)).toBe(true);
    expect(lines.some((l) => l.includes('remote'))).toBe(true);

    lines.length = 0;
    expect(await handleTuiSlash('/compact keep', ctx)).toBe(true);
    expect(compactFn).toHaveBeenCalled();
    expect(lines.some((l) => /6 → 2/.test(l))).toBe(true);
    expect(session.messages).toHaveLength(2);
  });
});
