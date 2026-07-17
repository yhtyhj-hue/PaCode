/**
 * Bridge local WebSocket session relay — bridge/v1-local
 *
 * 默认仅 loopback；--allow-lan 需 token 文件校验。
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  BRIDGE_SESSION_CONTRACT,
  bridgeSessionOp,
  type BridgeSessionAction,
  type BridgeSessionRequest,
} from './session.js';

export const BRIDGE_RELAY_CONTRACT = 'bridge/v1-local' as const;

export interface RelayServerOptions {
  host?: string;
  port?: number;
  /** 非 loopback 时必填：token 文件路径或明文 token */
  token?: string;
  tokenFile?: string;
  allowLan?: boolean;
  sessionsDir?: string;
}

export interface RelayServerHandle {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

type ClientMsg = {
  type?: string;
  action?: BridgeSessionAction;
  session_id?: string;
  token?: string;
};

/** 启动本机/局域网 session 中继 */
export async function startSessionRelayServer(
  options: RelayServerOptions = {}
): Promise<RelayServerHandle> {
  const allowLan = Boolean(options.allowLan);
  const host = options.host ?? (allowLan ? '0.0.0.0' : '127.0.0.1');
  const port = options.port ?? 0;

  if (allowLan || !isLoopbackHost(host)) {
    const token = resolveToken(options);
    if (!token) {
      throw new Error(
        'Non-loopback bridge relay requires --token or --token-file (PACODE_BRIDGE_TOKEN)'
      );
    }
  }

  const expectedToken = resolveToken(options);

  const httpServer: HttpServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`PaCode bridge relay ${BRIDGE_RELAY_CONTRACT}\n`);
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', (raw) => {
      void handleClientMessage(socket, raw.toString('utf-8'), {
        expectedToken,
        requireToken: Boolean(expectedToken) && (allowLan || !isLoopbackHost(host)),
        sessionsDir: options.sessionsDir,
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve());
  });

  const addr = httpServer.address();
  const boundPort =
    typeof addr === 'object' && addr ? addr.port : typeof port === 'number' ? port : 0;
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;

  return {
    host,
    port: boundPort,
    url: `ws://${displayHost}:${boundPort}`,
    close: async () => {
      await new Promise<void>((resolve) => {
        wss.close(() => {
          httpServer.close(() => resolve());
        });
      });
    },
  };
}

async function handleClientMessage(
  socket: WebSocket,
  text: string,
  ctx: { expectedToken?: string; requireToken: boolean; sessionsDir?: string }
): Promise<void> {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(text) as ClientMsg;
  } catch {
    send(socket, { ok: false, error: 'invalid JSON' });
    return;
  }

  if (ctx.requireToken) {
    if (!ctx.expectedToken || msg.token !== ctx.expectedToken) {
      send(socket, { ok: false, error: 'unauthorized' });
      socket.close();
      return;
    }
  }

  const action = (msg.action ?? msg.type ?? 'list') as BridgeSessionAction;
  const req: BridgeSessionRequest = {
    action: ['list', 'attach', 'detach', 'status'].includes(action) ? action : 'list',
    session_id: msg.session_id,
  };
  const result = bridgeSessionOp(req, { sessionsDir: ctx.sessionsDir });
  send(socket, {
    ...result,
    contract: BRIDGE_SESSION_CONTRACT,
  });
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function resolveToken(options: RelayServerOptions): string | undefined {
  if (options.token?.trim()) return options.token.trim();
  if (options.tokenFile && existsSync(options.tokenFile)) {
    return readFileSync(options.tokenFile, 'utf-8').trim();
  }
  const env = process.env['PACODE_BRIDGE_TOKEN']?.trim();
  return env || undefined;
}
