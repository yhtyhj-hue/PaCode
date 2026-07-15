/**
 * Localhost HTTP callback server used to capture the OAuth redirect.
 *
 * Behavior:
 *   - Listens on a random localhost port (default host: 127.0.0.1)
 *   - Accepts only GET /callback (the configured path)
 *   - Validates `state` parameter against an expected value
 *   - Returns a friendly HTML page to the user agent
 *   - Times out after a configurable deadline (default 60s)
 *
 * The `start()` function returns a server-info promise plus an
 * `awaitCallback()` promise that resolves ONLY when the user agent
 * hits the redirect (or the timeout elapses). This lets callers build
 * the authorization URL while the server is already waiting.
 *
 * Reject-everything-else: non-callback paths return 404 to avoid
 * leaking the server onto other interfaces.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpAuthError } from './types.js';

export interface CallbackServerOptions {
  /** Default '/callback'. */
  path?: string;
  /** Default 60_000 ms. */
  timeoutMs?: number;
  /** Default '127.0.0.1'. */
  host?: string;
  /** Default 0 (kernel chooses). */
  port?: number;
}

export interface CallbackResult {
  code: string;
  state: string;
  receivedAt: number;
}

export interface CallbackServer {
  /** Redirect URI the server is bound to (resolved after listen). */
  redirectUri: string;
  /** Resolves once the user agent hits the callback, or rejects on timeout. */
  awaitCallback: () => Promise<CallbackOutcome>;
  /** Force the server to close. Idempotent. */
  close: () => Promise<void>;
}

export type CallbackOutcome =
  | { ok: true; result: CallbackResult }
  | { ok: false; error: McpAuthError };

const DEFAULT_PATH = '/callback';
const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_HOST = '127.0.0.1';

function sendHtml(res: ServerResponse, status: number, title: string, body: string): void {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:sans-serif;max-width:480px;margin:64px auto;padding:0 16px"><h1>${title}</h1><p>${body}</p></body></html>`;
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(html);
}

/**
 * Validate that a URL is an http://localhost URI.
 * Rejects anything else (no IPs other than loopback, no https).
 */
export function validateRedirectUri(redirectUri: string): McpAuthError | null {
  try {
    const u = new URL(redirectUri);
    if (u.protocol !== 'http:') {
      return { category: 'redirect_uri_rejected', message: 'redirect_uri must use http://' };
    }
    const host = u.hostname.toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
      return {
        category: 'redirect_uri_rejected',
        message: `redirect_uri host must be localhost (got ${host})`,
      };
    }
    return null;
  } catch (e) {
    return {
      category: 'redirect_uri_rejected',
      message: `invalid redirect_uri: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Open a localhost callback server. The returned `awaitCallback()`
 * resolves only on user-agent redirect (or timeout).
 */
export function startCallbackServer(
  expectedState: string,
  options: CallbackServerOptions = {},
): Promise<CallbackServer> {
  const path = options.path ?? DEFAULT_PATH;
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? 0;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;

  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    return Promise.reject(
      new Error(`callback host must be loopback (got ${host})`),
    );
  }

  return new Promise<CallbackServer>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let resolveCallback: ((o: CallbackOutcome) => void) | null = null;
    let serverClosed = false;

    const safeClose = async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (serverClosed) return;
      serverClosed = true;
      try {
        await new Promise<void>((r) => server.close(() => r()));
      } catch {
        /* ignore */
      }
    };

    const settle = (outcome: CallbackOutcome) => {
      if (settled) return;
      settled = true;
      resolveCallback?.(outcome);
      void safeClose();
    };

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) {
        sendHtml(res, 400, 'Bad request', 'missing URL');
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`);
      if (url.pathname !== path) {
        sendHtml(res, 404, 'Not found', 'unknown callback path');
        return;
      }
      if (req.method !== 'GET') {
        sendHtml(res, 405, 'Method not allowed', 'callback must use GET');
        return;
      }
      const errorParam = url.searchParams.get('error');
      if (errorParam) {
        const desc = url.searchParams.get('error_description') ?? errorParam;
        settle({
          ok: false,
          error: {
            category: errorParam === 'access_denied' ? 'access_denied' : 'invalid_request',
            message: desc,
          },
        });
        sendHtml(res, 200, 'Authorization failed', desc);
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code) {
        settle({
          ok: false,
          error: { category: 'invalid_request', message: 'missing code in callback' },
        });
        sendHtml(res, 400, 'Bad request', 'missing code');
        return;
      }
      if (!state || state !== expectedState) {
        settle({
          ok: false,
          error: { category: 'state_mismatch', message: 'state parameter does not match' },
        });
        sendHtml(res, 400, 'Bad request', 'state mismatch');
        return;
      }
      settle({
        ok: true,
        result: { code, state, receivedAt: Date.now() },
      });
      sendHtml(res, 200, 'Authorized', 'You can close this window and return to PaCode.');
    });

    server.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(new Error(`callback server error: ${err.message}`));
      }
    });

    server.listen(port, host, () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr) {
        if (!settled) {
          settled = true;
          reject(new Error('callback server failed to bind'));
        }
        return;
      }
      const redirectUri = `http://127.0.0.1:${addr.port}${path}`;

      timer = setTimeout(() => {
        settle({
          ok: false,
          error: { category: 'timeout', message: 'callback timed out' },
        });
      }, timeoutMs);
      timer.unref?.();

      const callbackPromise = new Promise<CallbackOutcome>((res) => {
        resolveCallback = res;
      });

      resolve({
        redirectUri,
        awaitCallback: () => callbackPromise,
        close: safeClose,
      });
    });
  });
}

/** Return the port the given server bound to (test helper). */
export function getBoundPort(server: Server): number | null {
  const addr = server.address() as AddressInfo | null;
  return addr ? addr.port : null;
}