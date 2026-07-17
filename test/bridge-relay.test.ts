/**
 * Bridge relay — 双端 mock WS（计划验收文件名）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import {
  BRIDGE_RELAY_CONTRACT,
  BRIDGE_SESSION_CONTRACT,
  setAttachedSessionId,
  startSessionRelayServer,
} from '../src/services/bridge/index.js';
import { PermissionMode, type SessionState } from '../src/pkg/types.js';

describe('bridge/v1-local relay', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bridge-relay-'));
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    setAttachedSessionId(null);
    const state: SessionState = {
      sessionId: 'relay1',
      messages: [{ role: 'user', content: 'ping', timestamp: 1 }],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    };
    writeFileSync(join(dir, 'sessions', 'session_relay1.json'), JSON.stringify(state));
  });

  afterEach(() => {
    setAttachedSessionId(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it('exports relay contract', () => {
    expect(BRIDGE_RELAY_CONTRACT).toBe('bridge/v1-local');
  });

  it('list then attach over WebSocket', async () => {
    const sessionsDir = join(dir, 'sessions');
    const handle = await startSessionRelayServer({
      host: '127.0.0.1',
      port: 0,
      sessionsDir,
    });
    try {
      const listReply = await wsRoundTrip(handle.url, { action: 'list' });
      expect(listReply['contract']).toBe(BRIDGE_SESSION_CONTRACT);
      expect(listReply['ok']).toBe(true);
      const sessions = listReply['sessions'] as Array<{ session_id: string }>;
      expect(sessions.some((s) => s.session_id === 'relay1')).toBe(true);

      const attachReply = await wsRoundTrip(handle.url, {
        action: 'attach',
        session_id: 'relay1',
      });
      expect(attachReply['ok']).toBe(true);
      expect((attachReply['session'] as SessionState).sessionId).toBe('relay1');
    } finally {
      await handle.close();
    }
  });
});

function wsRoundTrip(
  url: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timeout'));
    }, 5000);
    ws.on('open', () => ws.send(JSON.stringify(payload)));
    ws.on('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString('utf-8')) as Record<string, unknown>);
      ws.close();
    });
    ws.on('error', reject);
  });
}
