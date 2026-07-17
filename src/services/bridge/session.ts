/**
 * Bridge remote session protocol v0 — 契约已定；中继实现 deferred
 *
 * Wire format (future):
 *   attach { session_id, host?, token? } → { ok, session }
 *   list   {} → { sessions: BridgeSessionRef[] }
 *   detach { session_id } → { ok }
 *   status { session_id } → { ok, session }
 */

export const BRIDGE_SESSION_CONTRACT = 'bridge/v0-session' as const;

export type BridgeSessionAction = 'list' | 'attach' | 'detach' | 'status';

/** 远程会话引用（未来 attach 成功后返回） */
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
  ok: false;
  status: 'deferred';
  action: BridgeSessionAction;
  error: string;
  hint: string;
  /** 预留：实现后填充 */
  sessions?: BridgeSessionRef[];
}

const HINT =
  'Use /resume for same-machine sessions, or remote MCP (sse/http/websocket) via /bridge inventory.';

/** 所有 session 操作当前一律 deferred（无网络中继） */
export function bridgeSessionOp(req: BridgeSessionRequest): BridgeSessionOpResult {
  const action = req.action;
  if (action === 'attach' && !req.session_id?.trim()) {
    return {
      contract: BRIDGE_SESSION_CONTRACT,
      ok: false,
      status: 'deferred',
      action,
      error: 'attach requires session_id (protocol reserved; relay not implemented)',
      hint: HINT,
    };
  }
  if ((action === 'detach' || action === 'status') && !req.session_id?.trim()) {
    return {
      contract: BRIDGE_SESSION_CONTRACT,
      ok: false,
      status: 'deferred',
      action,
      error: `${action} requires session_id (protocol reserved; relay not implemented)`,
      hint: HINT,
    };
  }
  return {
    contract: BRIDGE_SESSION_CONTRACT,
    ok: false,
    status: 'deferred',
    action,
    error: `Bridge session ${action} is not implemented (contract ${BRIDGE_SESSION_CONTRACT})`,
    hint: HINT,
    sessions: action === 'list' ? [] : undefined,
  };
}

export function formatBridgeSessionOp(result: BridgeSessionOpResult): string {
  const lines = [
    `Bridge session: ${result.status}`,
    `action=${result.action} ok=${result.ok}`,
    result.error,
    `hint: ${result.hint}`,
    `contract=${result.contract}`,
  ];
  if (result.sessions) {
    lines.splice(3, 0, `sessions: ${result.sessions.length}`);
  }
  return lines.join('\n');
}

export function parseBridgeSessionArgs(args: string[]): BridgeSessionRequest | null {
  // /bridge session list|attach|detach|status ...
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
