/**
 * McpAuth Service - Public API
 *
 * Registers the McpAuth tool with a ToolRegistry. The tool performs a
 * full OAuth 2.0 Authorization Code + PKCE flow against an MCP server:
 *
 *   1. Generate state + PKCE pair (S256).
 *   2. Open a localhost HTTP callback server.
 *   3. Hand the authorization URL back to the user (open in browser).
 *   4. Wait for the redirect with `code`.
 *   5. Exchange the code for tokens at the token endpoint.
 *   6. Persist the encrypted session.
 *
 * The tool is marked `concurrencySafe: false` because the callback
 * server is per-invocation and must not be raced.
 */

import { PermissionMode, ToolDefinition } from '../../pkg/types.js';
import { ToolRegistry } from '../../tools/registry.js';
import { Logger } from '../../pkg/logger/index.js';
import { McpAuthInput, McpAuthSession } from './types.js';
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  generatePkcePair,
  generateState,
  refreshAccessToken,
  validateInput,
  verifyState,
  isExpired,
  FetchLike,
} from './oauth-flow.js';
import { startCallbackServer, validateRedirectUri } from './callback-server.js';
import { createFileTokenStore } from './token-store.js';
import type { TokenStore } from './types.js';

export type {
  McpAuthInput,
  McpAuthSession,
  TokenStore,
  StoredCredentialSummary,
  McpAuthError,
  McpAuthErrorCategory,
  McpAuthTool,
} from './types.js';
export { LOCALHOST_HOSTNAMES } from './types.js';
export {
  generateCodeVerifier,
  generatePkcePair,
  generateState,
  computeCodeChallengeS256,
  buildAuthorizationUrl,
  validateInput as validateMcpAuthInput,
  verifyState,
  isExpired,
  exchangeAuthorizationCode,
  refreshAccessToken,
  base64UrlEncode,
} from './oauth-flow.js';
export {
  startCallbackServer,
  validateRedirectUri,
} from './callback-server.js';
export {
  createFileTokenStore,
  machineFingerprint,
  makeKey,
  deleteStoreFile,
} from './token-store.js';

export const MCP_AUTH_TOOL_NAME = 'McpAuth';

/** Hook surface for tests. */
export interface McpAuthDeps {
  store?: TokenStore;
  /** Inject a custom fetch impl. */
  fetchImpl?: FetchLike;
  /** Inject a custom callback server starter (mostly for tests). */
  startCallback?: typeof startCallbackServer;
  /** Override the clock. */
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Result of opening a callback server + building an authorization URL.
 * The caller drives the user-agent side (open browser); then awaits
 * `awaitCallback()` which resolves once the redirect completes.
 */
export interface StartedAuthFlow {
  authorization_url: string;
  /** Resolves to the exchanged-and-stored session, or an error. */
  awaitCallback: () => Promise<
    { ok: true; session: McpAuthSession } | { ok: false; error: import('./types.js').McpAuthError }
  >;
  close: () => Promise<void>;
}

/**
 * Open the callback server, generate PKCE + state, build the auth URL.
 */
export async function startMcpAuthFlow(
  input: McpAuthInput,
  deps: McpAuthDeps = {},
): Promise<
  { ok: true; flow: StartedAuthFlow } | { ok: false; error: import('./types.js').McpAuthError }
> {
  const validation = validateInput(input);
  if (validation) return { ok: false, error: validation };
  const redirectValidation = validateRedirectUri(input.redirect_uri);
  if (redirectValidation) return { ok: false, error: redirectValidation };

  const state = generateState();
  const pkce = generatePkcePair();
  const startCb = deps.startCallback ?? startCallbackServer;

  let cb;
  try {
    cb = await startCb(state, {
      host: '127.0.0.1',
      port: 0,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (e) {
    return {
      ok: false,
      error: { category: 'io', message: e instanceof Error ? e.message : String(e) },
    };
  }

  const adjustedInput: McpAuthInput = { ...input, redirect_uri: cb.redirectUri };
  const authorization_url = buildAuthorizationUrl(adjustedInput, state, pkce);

  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const store = deps.store ?? createFileTokenStore();

  const awaitCallback = async () => {
    const outcome = await cb.awaitCallback();
    if (!outcome.ok) {
      return { ok: false as const, error: outcome.error };
    }
    if (!verifyState(state, outcome.result.state)) {
      return {
        ok: false as const,
        error: {
          category: 'state_mismatch' as const,
          message: 'state mismatch (defense in depth)',
        },
      };
    }
    const exchange = await exchangeAuthorizationCode(
      adjustedInput,
      outcome.result.code,
      pkce,
      fetchImpl,
    );
    if (!exchange.ok) {
      return { ok: false as const, error: exchange.error };
    }
    const session: McpAuthSession = {
      ...exchange.session,
      state,
      code_verifier: pkce.code_verifier,
      code_challenge: pkce.code_challenge,
    };
    await store.save(session);
    return { ok: true as const, session };
  };

  return {
    ok: true,
    flow: {
      authorization_url,
      awaitCallback,
      close: () => cb.close(),
    },
  };
}

/**
 * Refresh a stored token if it has (or is about to) expire.
 */
export async function refreshStoredToken(
  store: TokenStore,
  input: McpAuthInput,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<
  | { ok: true; session: McpAuthSession }
  | { ok: false; error: import('./types.js').McpAuthError }
> {
  const existing = await store.load(input.server_url, input.client_id);
  if (!existing) {
    return { ok: false, error: { category: 'invalid_grant', message: 'no stored token' } };
  }
  if (!existing.refresh_token) {
    return { ok: false, error: { category: 'invalid_grant', message: 'no refresh_token' } };
  }
  if (!isExpired(existing)) {
    return { ok: true, session: existing };
  }
  const result = await refreshAccessToken(
    {
      token_endpoint: input.token_endpoint,
      client_id: input.client_id,
      server_url: input.server_url,
    },
    existing.refresh_token,
    fetchImpl,
  );
  if (!result.ok) return { ok: false, error: result.error };
  const session: McpAuthSession = {
    ...result.session,
    state: existing.state,
    code_verifier: existing.code_verifier,
    code_challenge: existing.code_challenge,
    // Keep refresh_token if provider didn't return one (RFC 6749 §6).
    refresh_token: result.session.refresh_token ?? existing.refresh_token,
    server_url: input.server_url,
    client_id: input.client_id,
  };
  await store.save(session);
  return { ok: true, session };
}

const _log = new Logger({ prefix: 'McpAuth' });

/**
 * Register the McpAuth tool with a ToolRegistry.
 *
 * The tool:
 *   - Validates input.
 *   - Opens a callback server.
 *   - Returns the authorization_url immediately so the host UI can
 *     open a browser.
 *   - Awaits the callback, exchanges the code, and persists the token.
 *   - Emits a final ToolResult with the access_token (or error).
 *
 * Concurrency: false. Two simultaneous flows would race the callback
 * server's random port.
 */
export function registerMcpAuthTool(
  registry: ToolRegistry,
  deps: McpAuthDeps = {},
): void {
  const tool: ToolDefinition = {
    name: MCP_AUTH_TOOL_NAME,
    description:
      'Perform OAuth 2.0 (Authorization Code + PKCE) authentication for an MCP server. Returns the authorization URL the user must open in a browser; persists the resulting access token encrypted to ~/.paude/mcp-auth.json with 0600 permissions.',
    inputSchema: {
      type: 'object',
      properties: {
        server_url: { type: 'string' },
        client_id: { type: 'string' },
        redirect_uri: { type: 'string' },
        auth_endpoint: { type: 'string' },
        token_endpoint: { type: 'string' },
        scopes: { type: 'array', items: { type: 'string' } },
      },
      required: [
        'server_url',
        'client_id',
        'redirect_uri',
        'auth_endpoint',
        'token_endpoint',
        'scopes',
      ],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.ACCEPT_EDITS,
    async execute(rawInput) {
      const input = rawInput as McpAuthInput;
      const started = await startMcpAuthFlow(input, deps);
      if (!started.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `McpAuth failed: [${started.error.category}] ${started.error.message}`,
            },
          ],
          isError: true,
        };
      }
      const finished = await started.flow.awaitCallback();
      await started.flow.close();
      if (!finished.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `McpAuth failed: [${finished.error.category}] ${finished.error.message}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                authorization_url: started.flow.authorization_url,
                access_token: finished.session.access_token,
                token_type: finished.session.token_type,
                expires_at: finished.session.expires_at,
                scope: finished.session.scope,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  };
  registry.register(tool);
  _log.debug(`registered ${MCP_AUTH_TOOL_NAME}`);
}