/**
 * K7 Ink TUI unit tests
 */

import { describe, it, expect } from 'vitest';
import { shouldEnableTui } from '../src/cli/tui/enable.js';
import {
  appendDelta,
  formatToolLine,
  truncateLines,
  type TuiLine,
} from '../src/cli/tui/frames.js';
import { createInterruptGate, type TuiController } from '../src/cli/tui/app.js';
import { handleTuiSlash, TUI_SLASH_HELP } from '../src/cli/tui/slash.js';
import { PermissionMode, type SessionState } from '../src/pkg/types.js';
import type { OutputStyle } from '../src/cli/output-styles.js';

function mockCtl(): TuiController & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    appendUser: (t) => lines.push(`U:${t}`),
    appendSystem: (t) => lines.push(`S:${t}`),
    appendError: (t) => lines.push(`E:${t}`),
    appendTool: (n, d) => lines.push(`T:${n}:${d ?? ''}`),
    appendAssistantDelta: (t) => lines.push(`A:${t}`),
    setBusy: () => undefined,
    setStatus: () => undefined,
    askConfirm: async () => true,
    askText: async () => '',
    setMode: () => undefined,
    requestInterrupt: () => undefined,
  };
}

describe('K7 shouldEnableTui', () => {
  it('requires flag or PACODE_TUI=1 and TTY', () => {
    expect(shouldEnableTui({ tuiFlag: false, env: {}, isTTY: true })).toBe(false);
    expect(shouldEnableTui({ tuiFlag: true, env: {}, isTTY: false })).toBe(false);
    expect(shouldEnableTui({ tuiFlag: true, env: {}, isTTY: true })).toBe(true);
    expect(shouldEnableTui({ tuiFlag: false, env: { PACODE_TUI: '1' }, isTTY: true })).toBe(
      true
    );
  });
});

describe('K7 frames', () => {
  it('formats tool lines and appends assistant deltas', () => {
    expect(formatToolLine('Bash', 'npm test')).toBe('▸ Bash npm test');
    let lines: TuiLine[] = [];
    lines = appendDelta(lines, 'Hello');
    lines = appendDelta(lines, ' world');
    expect(lines).toEqual([{ kind: 'assistant', text: 'Hello world' }]);
  });

  it('truncates long transcripts', () => {
    const many: TuiLine[] = Array.from({ length: 100 }, (_, i) => ({
      kind: 'system' as const,
      text: `line-${i}`,
    }));
    const out = truncateLines(many, 10);
    expect(out[0]?.kind).toBe('system');
    expect(out[0]?.text).toMatch(/earlier lines hidden/);
    expect(out).toHaveLength(11);
  });
});

describe('K7 interrupt gate', () => {
  it('trips and resets', () => {
    const g = createInterruptGate();
    expect(g.shouldAbort()).toBe(false);
    g.trip();
    expect(g.shouldAbort()).toBe(true);
    g.reset();
    expect(g.shouldAbort()).toBe(false);
  });
});

describe('K7 TUI slash', () => {
  it('help lists high-frequency commands', () => {
    expect(TUI_SLASH_HELP).toMatch(/doctor/);
    expect(TUI_SLASH_HELP).toMatch(/diff/);
    expect(TUI_SLASH_HELP).toMatch(/voice/);
    expect(TUI_SLASH_HELP).toMatch(/agents/);
  });

  it('handles /help /status /mode /style /agents /bridge /voice', async () => {
    const ctl = mockCtl();
    const session = {
      sessionId: 't1',
      messages: [],
      mode: PermissionMode.DEFAULT,
    } as unknown as SessionState;
    let style: OutputStyle = 'default';

    const makeCtx = () => ({
      ctl,
      session,
      model: 'claude-sonnet-4-5',
      apiKeyPresent: true,
      tokenUsage: { input: 1, output: 2 },
      outputStyle: style,
      setOutputStyle: (s: OutputStyle) => {
        style = s;
      },
    });

    expect(await handleTuiSlash('/help', makeCtx())).toBe(true);
    expect(ctl.lines.some((l) => l.includes('doctor'))).toBe(true);

    expect(await handleTuiSlash('/status', makeCtx())).toBe(true);
    expect(ctl.lines.some((l) => l.includes('session=t1'))).toBe(true);

    expect(await handleTuiSlash('/mode acceptEdits', makeCtx())).toBe(true);
    expect(session.mode).toBe(PermissionMode.ACCEPT_EDITS);

    expect(await handleTuiSlash('/style cost', makeCtx())).toBe(true);
    expect(style).toBe('cost');

    expect(await handleTuiSlash('/agents', makeCtx())).toBe(true);
    expect(ctl.lines.some((l) => l === 'Agents' || l.includes('Registered subagent'))).toBe(true);

    expect(await handleTuiSlash('/bridge', makeCtx())).toBe(true);
    expect(ctl.lines.some((l) => /Bridge status/i.test(l))).toBe(true);

    expect(await handleTuiSlash('/voice', makeCtx())).toBe(true);
    expect(ctl.lines.some((l) => /Voice status/i.test(l))).toBe(true);

    expect(await handleTuiSlash('/clear', makeCtx())).toBe(true);
    expect(session.messages).toEqual([]);
  });

  it('applies /rewind after confirm; cancels when denied', async () => {
    const ctl = mockCtl();
    let confirm = true;
    ctl.askConfirm = async () => confirm;

    const session = {
      sessionId: 't1',
      messages: [],
      mode: PermissionMode.DEFAULT,
    } as unknown as SessionState;

    const makeCtx = (rewindFn: typeof import('../src/services/checkpoint.js').rewindToDetailed) => ({
      ctl,
      session,
      model: 'm',
      apiKeyPresent: true,
      tokenUsage: { input: 0, output: 0 },
      outputStyle: 'default' as OutputStyle,
      setOutputStyle: () => undefined,
      rewindFn,
    });

    const okRewind = () => ({ ok: true as const });
    expect(await handleTuiSlash('/rewind s1/0', makeCtx(okRewind))).toBe(true);
    expect(ctl.lines.some((l) => l.includes('Rewound to s1/0'))).toBe(true);

    confirm = false;
    ctl.lines.length = 0;
    expect(await handleTuiSlash('/rewind s1/0', makeCtx(okRewind))).toBe(true);
    expect(ctl.lines.some((l) => l.includes('cancelled'))).toBe(true);

    confirm = true;
    ctl.lines.length = 0;
    const failRewind = () => ({
      ok: false as const,
      reason: 'dirty_conflict' as const,
      message: 'dirty tree — commit first',
    });
    expect(await handleTuiSlash('/rewind s1/0', makeCtx(failRewind))).toBe(true);
    expect(ctl.lines.some((l) => l.startsWith('E:') && l.includes('dirty'))).toBe(true);
  });
});
