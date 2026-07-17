/**
 * Bridge session protocol — bridge/v1-local：本机会话 list/attach + 可选 WS 中继
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionState } from '../../pkg/types.js';

export const BRIDGE_SESSION_CONTRACT = 'bridge/v1-local' as const;

export type BridgeSessionAction = 'list' | 'attach' | 'detach' | 'status';

export interface BridgeSessionRef {
  session_id: string;
  host?: string;
  updated_at?: number;
  message_count?: number;
}

export interface BridgeSessionRequest {
  action: BridgeSessionAction;
  session_id?: string;
  host?: string;
}

export interface BridgeSessionOpResult {
  contract: typeof BRIDGE_SESSION_CONTRACT;
  ok: boolean;
  status: 'ok' | 'error' | 'deferred';
  action: BridgeSessionAction;
  error?: string;
  hint?: string;
  sessions?: BridgeSessionRef[];
  session?: SessionState;
  attached_id?: string | null;
}

const HINT =
  'Local: /bridge session list|attach <id>. Relay: pacode bridge serve [--port] [--allow-lan].';

/** 当前 REPL 进程内 attach 的会话 id（非跨机） */
let attachedId: string | null = null;

export function getAttachedSessionId(): string | null {
  return attachedId;
}

export function setAttachedSessionId(id: string | null): void {
  attachedId = id;
}

export function defaultSessionsDir(cwd = process.cwd()): string {
  return join(cwd, '.paude', 'sessions');
}

/** 扫描 .paude/sessions/session_*.json */
export function listLocalSessionRefs(sessionsDir = defaultSessionsDir()): BridgeSessionRef[] {
  if (!existsSync(sessionsDir)) return [];
  const out: BridgeSessionRef[] = [];
  for (const name of readdirSync(sessionsDir)) {
    const m = /^session_(.+)\.json$/.exec(name);
    if (!m) continue;
    const full = join(sessionsDir, name);
    let updated_at: number | undefined;
    let message_count: number | undefined;
    try {
      updated_at = statSync(full).mtimeMs;
      const raw = JSON.parse(readFileSync(full, 'utf-8')) as SessionState;
      message_count = raw.messages?.length;
    } catch {
      /* skip corrupt */
    }
    out.push({ session_id: m[1]!, updated_at, message_count });
  }
  return out.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
}

export function loadLocalSession(
  sessionId: string,
  sessionsDir = defaultSessionsDir()
): SessionState | null {
  const path = join(sessionsDir, `session_${sessionId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SessionState;
  } catch {
    return null;
  }
}

/** 本机 session 操作；host 非本机且无中继时 deferred */
export function bridgeSessionOp(
  req: BridgeSessionRequest,
  options: { sessionsDir?: string } = {}
): BridgeSessionOpResult {
  const action = req.action;
  const dir = options.sessionsDir ?? defaultSessionsDir();

  // 显式远程 host（非 localhost）→ 需 WS 中继，本进程不代劳
  if (req.host && !isLocalHost(req.host)) {
    return {
      contract: BRIDGE_SESSION_CONTRACT,
      ok: false,
      status: 'deferred',
      action,
      error: `Remote host ${req.host} requires running relay (pacode bridge serve --allow-lan)`,
      hint: HINT,
    };
  }

  if (action === 'list') {
    const sessions = listLocalSessionRefs(dir);
    return {
      contract: BRIDGE_SESSION_CONTRACT,
      ok: true,
      status: 'ok',
      action,
      sessions,
      attached_id: attachedId,
      hint: HINT,
    };
  }

  if (action === 'attach') {
    const id = req.session_id?.trim();
    if (!id) {
      return {
        contract: BRIDGE_SESSION_CONTRACT,
        ok: false,
        status: 'error',
        action,
        error: 'attach requires session_id',
        hint: HINT,
      };
    }
    const session = loadLocalSession(id, dir);
    if (!session) {
      return {
        contract: BRIDGE_SESSION_CONTRACT,
        ok: false,
        status: 'error',
        action,
        error: `session not found: ${id}`,
        hint: HINT,
      };
    }
    attachedId = id;
    return {
      contract: BRIDGE_SESSION_CONTRACT,
      ok: true,
      status: 'ok',
      action,
      session,
      attached_id: id,
      hint: 'Attached locally. Use /resume <id> in REPL to load messages.',
    };
  }

  if (action === 'detach') {
    const id = req.session_id?.trim() ?? attachedId;
    if (!id) {
      return {
        contract: BRIDGE_SESSION_CONTRACT,
        ok: false,
        status: 'error',
        action,
        error: 'detach requires session_id (or prior attach)',
        hint: HINT,
      };
    }
    if (attachedId === id) attachedId = null;
    return {
      contract: BRIDGE_SESSION_CONTRACT,
      ok: true,
      status: 'ok',
      action,
      attached_id: attachedId,
      hint: HINT,
    };
  }

  if (action === 'status') {
    const id = req.session_id?.trim() ?? attachedId ?? undefined;
    if (!id) {
      return {
        contract: BRIDGE_SESSION_CONTRACT,
        ok: true,
        status: 'ok',
        action,
        attached_id: attachedId,
        sessions: listLocalSessionRefs(dir).slice(0, 5),
        hint: HINT,
      };
    }
    const session = loadLocalSession(id, dir);
    if (!session) {
      return {
        contract: BRIDGE_SESSION_CONTRACT,
        ok: false,
        status: 'error',
        action,
        error: `session not found: ${id}`,
        hint: HINT,
      };
    }
    return {
      contract: BRIDGE_SESSION_CONTRACT,
      ok: true,
      status: 'ok',
      action,
      session,
      attached_id: attachedId,
      hint: HINT,
    };
  }

  return {
    contract: BRIDGE_SESSION_CONTRACT,
    ok: false,
    status: 'error',
    action,
    error: `unknown action: ${String(action)}`,
    hint: HINT,
  };
}

function isLocalHost(host: string): boolean {
  const h = host.replace(/^https?:\/\//, '').split(':')[0]?.toLowerCase() ?? '';
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '';
}

export function formatBridgeSessionOp(result: BridgeSessionOpResult): string {
  const lines = [
    `Bridge session: ${result.status}`,
    `action=${result.action} ok=${result.ok}`,
  ];
  if (result.error) lines.push(result.error);
  if (result.hint) lines.push(`hint: ${result.hint}`);
  if (result.attached_id != null) lines.push(`attached=${result.attached_id}`);
  if (result.sessions) {
    lines.push(`sessions: ${result.sessions.length}`);
    for (const s of result.sessions.slice(0, 20)) {
      lines.push(
        `  - ${s.session_id}` +
          (s.message_count != null ? ` · ${s.message_count} msg` : '') +
          (s.updated_at != null ? ` · ${new Date(s.updated_at).toISOString()}` : '')
      );
    }
  }
  if (result.session) {
    lines.push(
      `session=${result.session.sessionId} messages=${result.session.messages.length}`
    );
  }
  lines.push(`contract=${result.contract}`);
  return lines.join('\n');
}

export function parseBridgeSessionArgs(args: string[]): BridgeSessionRequest | null {
  if (args[0] !== 'session') return null;
  const action = (args[1] ?? 'list') as BridgeSessionAction;
  if (!['list', 'attach', 'detach', 'status'].includes(action)) {
    return { action: 'list' };
  }
  return {
    action,
    session_id: args[2],
    host: args[3],
  };
}
