/**
 * Bridge session protocol v1-local + WebSocket relay
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import {
  BRIDGE_SESSION_CONTRACT,
  bridgeSessionOp,
  formatBridgeSessionOp,
  parseBridgeSessionArgs,
  formatBridgeStatus,
  getBridgeStatus,
  setAttachedSessionId,
  startSessionRelayServer,
} from '../src/services/bridge/index.js';
import { handleTuiSlash } from '../src/cli/tui/slash.js';
import { PermissionMode, type SessionState } from '../src/pkg/types.js';
import type { OutputStyle } from '../src/cli/output-styles.js';

describe('bridge/v1-local', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bridge-sess-'));
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    setAttachedSessionId(null);
    const state: SessionState = {
      sessionId: 'abc123',
      messages: [{ role: 'user', content: 'hi', timestamp: 1 }],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    };
    writeFileSync(join(dir, 'sessions', 'session_abc123.json'), JSON.stringify(state));
  });

  afterEach(() => {
    setAttachedSessionId(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it('list/attach/detach/status work against local sessions dir', () => {
    const sessionsDir = join(dir, 'sessions');
    const list = bridgeSessionOp({ action: 'list' }, { sessionsDir });
    expect(list.contract).toBe(BRIDGE_SESSION_CONTRACT);
    expect(list.ok).toBe(true);
    expect(list.status).toBe('ok');
    expect(list.sessions?.some((s) => s.session_id === 'abc123')).toBe(true);

    const attach = bridgeSessionOp({ action: 'attach', session_id: 'abc123' }, { sessionsDir });
    expect(attach.ok).toBe(true);
    expect(attach.session?.sessionId).toBe('abc123');
    expect(attach.attached_id).toBe('abc123');

    const status = bridgeSessionOp({ action: 'status', session_id: 'abc123' }, { sessionsDir });
    expect(status.ok).toBe(true);
    expect(status.session?.messages.length).toBe(1);

    const detach = bridgeSessionOp({ action: 'detach', session_id: 'abc123' }, { sessionsDir });
    expect(detach.ok).toBe(true);
    expect(detach.attached_id).toBeNull();

    const bad = bridgeSessionOp({ action: 'attach' }, { sessionsDir });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/session_id/);
  });

  it('remote host stays deferred', () => {
    const r = bridgeSessionOp({
      action: 'attach',
      session_id: 'x',
      host: 'example.com',
    });
    expect(r.status).toBe('deferred');
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

  it('formatBridgeStatus advertises v1-local session protocol', () => {
    const text = formatBridgeStatus(
      getBridgeStatus({ config: { servers: {} }, connections: [] })
    );
    expect(text).toContain('bridge/v1-local');
    expect(text).toContain('/bridge session list');
  });

  it('TUI /bridge session list prints v1-local contract', async () => {
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
    expect(lines.some((l) => /ok=true|status=ok|Bridge session: ok/i.test(l))).toBe(true);
  });

  it('WebSocket relay list/attach round-trip', async () => {
    const sessionsDir = join(dir, 'sessions');
    const handle = await startSessionRelayServer({
      host: '127.0.0.1',
      port: 0,
      sessionsDir,
    });
    try {
      const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const ws = new WebSocket(handle.url);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('timeout'));
        }, 5000);
        ws.on('open', () => {
          ws.send(JSON.stringify({ action: 'list' }));
        });
        ws.on('message', (data) => {
          clearTimeout(timer);
          resolve(JSON.parse(data.toString('utf-8')) as Record<string, unknown>);
          ws.close();
        });
        ws.on('error', reject);
      });
      expect(reply['contract']).toBe(BRIDGE_SESSION_CONTRACT);
      expect(reply['ok']).toBe(true);
      const sessions = reply['sessions'] as Array<{ session_id: string }>;
      expect(sessions.some((s) => s.session_id === 'abc123')).toBe(true);
    } finally {
      await handle.close();
    }
  });
});
