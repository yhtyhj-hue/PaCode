/**
 * Bridge session protocol v0 (deferred relay)
 */
import { describe, it, expect } from 'vitest';
import {
  BRIDGE_SESSION_CONTRACT,
  bridgeSessionOp,
  formatBridgeSessionOp,
  parseBridgeSessionArgs,
  formatBridgeStatus,
  getBridgeStatus,
} from '../src/services/bridge/index.js';
import { handleTuiSlash } from '../src/cli/tui/slash.js';
import { PermissionMode, type SessionState } from '../src/pkg/types.js';
import type { OutputStyle } from '../src/cli/output-styles.js';

describe('bridge/v0-session', () => {
  it('list/attach/detach/status are deferred with contract', () => {
    const list = bridgeSessionOp({ action: 'list' });
    expect(list.contract).toBe(BRIDGE_SESSION_CONTRACT);
    expect(list.ok).toBe(false);
    expect(list.status).toBe('deferred');
    expect(list.sessions).toEqual([]);
    expect(formatBridgeSessionOp(list)).toContain('bridge/v0-session');

    const attach = bridgeSessionOp({ action: 'attach', session_id: 's1' });
    expect(attach.error).toMatch(/not implemented/i);

    const bad = bridgeSessionOp({ action: 'attach' });
    expect(bad.error).toMatch(/session_id/);
  });

  it('parseBridgeSessionArgs recognizes /bridge session …', () => {
    expect(parseBridgeSessionArgs([])).toBeNull();
    expect(parseBridgeSessionArgs(['status'])).toBeNull();
    expect(parseBridgeSessionArgs(['session'])).toEqual({ action: 'list' });
    expect(parseBridgeSessionArgs(['session', 'attach', 'abc', 'host1'])).toEqual({
      action: 'attach',
      session_id: 'abc',
      host: 'host1',
    });
  });

  it('formatBridgeStatus advertises session protocol', () => {
    const text = formatBridgeStatus(
      getBridgeStatus({ config: { servers: {} }, connections: [] })
    );
    expect(text).toContain('bridge/v0-session');
    expect(text).toContain('/bridge session list');
  });

  it('TUI /bridge session list prints deferred contract', async () => {
    const lines: string[] = [];
    const ctl = {
      appendSystem: (l: string) => lines.push(l),
      appendError: () => undefined,
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
    const session = {
      sessionId: 's',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    } as SessionState;
    expect(
      await handleTuiSlash('/bridge session list', {
        ctl: ctl as never,
        session,
        model: 'm',
        apiKeyPresent: true,
        tokenUsage: { input: 0, output: 0 },
        outputStyle: 'default' as OutputStyle,
        setOutputStyle: () => undefined,
      })
    ).toBe(true);
    expect(lines.some((l) => l.includes(BRIDGE_SESSION_CONTRACT))).toBe(true);
    expect(lines.some((l) => /deferred/i.test(l))).toBe(true);
  });
});
