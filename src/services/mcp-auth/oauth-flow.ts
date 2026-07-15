/**
 * OAuth 2.0 Authorization Code flow with PKCE (RFC 7636).
 *
 * Provides:
 *   - PKCE code_verifier / code_challenge generation (S256)
 *   - state parameter generation for CSRF defense
 *   - authorization URL construction
 *   - code -> token exchange (POST application/x-www-form-urlencoded)
 *   - refresh_token -> access_token rotation
 *
 * Designed to be testable: the HTTP transport is injected via
 * `fetchImpl`, defaulting to the global `fetch`.
 */

import { createHash, randomBytes } from 'node:crypto';
import type {
  McpAuthError,
  McpAuthErrorCategory,
  McpAuthInput,
  McpAuthSession,
  TokenExchangeResult,
} from './types.js';

/**
 * Public fetch signature. Node 18+ ships with a global fetch; tests
 * inject a deterministic mock.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/** OAuth error (RFC 6749 §5.2) keys mapped to our category. */
const RFC6749_ERROR_CATEGORY: Record<string, McpAuthErrorCategory> = {
  invalid_request: 'invalid_request',
  invalid_client: 'invalid_client',
  invalid_grant: 'invalid_grant',
  invalid_scope: 'invalid_scope',
  unauthorized_client: 'unauthorized_client',
  unsupported_grant_type: 'unsupported_grant_type',
  access_denied: 'access_denied',
  server_error: 'server_error',
  temporarily_unavailable: 'temporarily_unavailable',
};

/** Generate a high-entropy URL-safe token. */
function randomUrlSafe(byteLength: number): string {
  return base64UrlEncode(randomBytes(byteLength));
}

/** Base64 URL encoding without padding (RFC 4648 §5). */
export function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Generate a PKCE code_verifier: 43-128 char URL-safe string. */
export function generateCodeVerifier(): string {
  // 32 bytes -> 43 base64url chars after stripping padding; RFC 7636 §4.1
  // mandates 43-128 chars and [A-Z][a-z][0-9]-._~.
  return randomUrlSafe(32);
}

/** Compute the S256 code_challenge for a verifier. */
export function computeCodeChallengeS256(verifier: string): string {
  const hash = createHash('sha256').update(verifier, 'ascii').digest();
  return base64UrlEncode(hash);
}

/** Generate the OAuth state parameter (CSRF defense). */
export function generateState(): string {
  // 16 bytes -> 22 base64url chars; unguessable.
  return randomUrlSafe(16);
}

/** Pair of (verifier, challenge) suitable for one OAuth request. */
export interface PkcePair {
  code_verifier: string;
  code_challenge: string;
  code_challenge_method: 'S256';
}

/** Build a complete PKCE pair with method pinned to S256. */
export function generatePkcePair(): PkcePair {
  const code_verifier = generateCodeVerifier();
  return {
    code_verifier,
    code_challenge: computeCodeChallengeS256(code_verifier),
    code_challenge_method: 'S256',
  };
}

/**
 * Validate inputs up-front. Empty / missing fields produce a typed
 * `invalid_request` error rather than a network round trip.
 */
export function validateInput(input: McpAuthInput): McpAuthError | null {
  if (!input || typeof input !== 'object') {
    return mkError('invalid_request', 'input must be an object');
  }
  const required: (keyof McpAuthInput)[] = [
    'server_url',
    'client_id',
    'redirect_uri',
    'auth_endpoint',
    'token_endpoint',
    'scopes',
  ];
  for (const key of required) {
    const v = input[key];
    if (v === undefined || v === null || v === '') {
      return mkError('invalid_request', `missing required field: ${key}`);
    }
  }
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    return mkError('invalid_request', 'scopes must be a non-empty array');
  }
  for (const s of input.scopes) {
    if (typeof s !== 'string' || s.length === 0) {
      return mkError('invalid_request', 'scopes must contain non-empty strings');
    }
  }
  try {
    const u = new URL(input.auth_endpoint);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
      return mkError('invalid_request', 'auth_endpoint must use https (or localhost)');
    }
    const t = new URL(input.token_endpoint);
    if (t.protocol !== 'https:' && t.hostname !== 'localhost' && t.hostname !== '127.0.0.1') {
      return mkError('invalid_request', 'token_endpoint must use https (or localhost)');
    }
    const r = new URL(input.redirect_uri);
    if (r.protocol !== 'http:') {
      return mkError('redirect_uri_rejected', 'redirect_uri must use http://localhost');
    }
    if (r.hostname !== 'localhost' && r.hostname !== '127.0.0.1') {
      return mkError('redirect_uri_rejected', 'redirect_uri host must be localhost');
    }
  } catch (e) {
    return mkError(
      'invalid_request',
      `invalid URL: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return null;
}

function mkError(category: McpAuthErrorCategory, message: string): McpAuthError {
  return { category, message };
}

/**
 * Construct the authorization URL the user should be redirected to.
 *
 * `state` and `code_challenge` are caller-provided (kept here as plain
 * parameters so the flow can be tested without random sources).
 */
export function buildAuthorizationUrl(
  input: McpAuthInput,
  state: string,
  pkce: PkcePair,
): string {
  const url = new URL(input.auth_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.client_id);
  url.searchParams.set('redirect_uri', input.redirect_uri);
  url.searchParams.set('scope', input.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pkce.code_challenge);
  url.searchParams.set('code_challenge_method', pkce.code_challenge_method);
  // Resource indicator (RFC 8707) — recommended for MCP servers.
  url.searchParams.set('resource', input.server_url);
  return url.toString();
}

/**
 * Token endpoint response (RFC 6749 §5.1).
 */
interface RawTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
}

function parseTokenResponse(
  raw: unknown,
  serverUrl: string,
  clientId: string,
  status: number,
): TokenExchangeResult {
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      error: { category: 'unknown', message: 'token response is not an object', status },
    };
  }
  const body = raw as RawTokenResponse;
  if (typeof body.error === 'string') {
    const category =
      RFC6749_ERROR_CATEGORY[body.error] ?? 'unknown';
    return {
      ok: false,
      error: {
        category,
        message:
          typeof body.error_description === 'string'
            ? body.error_description
            : body.error,
        status,
      },
    };
  }
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    return {
      ok: false,
      error: { category: 'invalid_grant', message: 'missing access_token', status },
    };
  }
  const expires_in_num =
    typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in);
  if (!Number.isFinite(expires_in_num) || expires_in_num <= 0) {
    return {
      ok: false,
      error: { category: 'invalid_grant', message: 'missing or invalid expires_in', status },
    };
  }
  const token_type = typeof body.token_type === 'string' ? body.token_type : 'Bearer';
  const scope = typeof body.scope === 'string' ? body.scope : undefined;
  const refresh_token =
    typeof body.refresh_token === 'string' && body.refresh_token.length > 0
      ? body.refresh_token
      : undefined;

  const session: McpAuthSession = {
    state: '',
    code_verifier: '',
    code_challenge: '',
    access_token: body.access_token,
    refresh_token,
    scope,
    token_type,
    expires_in: expires_in_num,
    expires_at: Date.now() + Math.floor(expires_in_num * 1000),
    server_url: serverUrl,
    client_id: clientId,
  };
  return { ok: true, session };
}

/**
 * Exchange an authorization code for tokens (grant_type=authorization_code).
 */
export async function exchangeAuthorizationCode(
  input: McpAuthInput,
  code: string,
  pkce: PkcePair,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<TokenExchangeResult> {
  if (typeof code !== 'string' || code.length === 0) {
    return {
      ok: false,
      error: { category: 'invalid_request', message: 'code is empty' },
    };
  }
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: input.redirect_uri,
    client_id: input.client_id,
    code_verifier: pkce.code_verifier,
  });
  try {
    const res = await fetchImpl(input.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: params.toString(),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: {
          category: res.status >= 500 ? 'server_error' : 'invalid_grant',
          message: 'token endpoint returned non-JSON body',
          status: res.status,
          body: text.slice(0, 512),
        },
      };
    }
    const result = parseTokenResponse(json, input.server_url, input.client_id, res.status);
    if (!result.ok) {
      // Ensure body is captured for debugging without losing type.
      return {
        ok: false,
        error: { ...result.error, body: text.slice(0, 512) },
      };
    }
    return result;
  } catch (e) {
    return {
      ok: false,
      error: {
        category: 'network',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

/**
 * Refresh an access token using a refresh_token (grant_type=refresh_token).
 */
export async function refreshAccessToken(
  input: Pick<McpAuthInput, 'token_endpoint' | 'client_id' | 'server_url'>,
  refreshToken: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<TokenExchangeResult> {
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return {
      ok: false,
      error: { category: 'invalid_request', message: 'refresh_token is empty' },
    };
  }
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: input.client_id,
  });
  try {
    const res = await fetchImpl(input.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: params.toString(),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: {
          category: res.status >= 500 ? 'server_error' : 'invalid_grant',
          message: 'token endpoint returned non-JSON body',
          status: res.status,
          body: text.slice(0, 512),
        },
      };
    }
    return parseTokenResponse(json, input.server_url, input.client_id, res.status);
  } catch (e) {
    return {
      ok: false,
      error: {
        category: 'network',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

/**
 * Verify the `state` returned by the redirect matches the value we sent.
 * Constant-time compare to avoid timing leaks.
 */
export function verifyState(expected: string, received: string): boolean {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  if (expected.length !== received.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return result === 0;
}

/** Return true if a session is within `skewSeconds` of expiry. */
export function isExpired(session: McpAuthSession, skewSeconds = 30): boolean {
  return session.expires_at - Date.now() <= skewSeconds * 1000;
}