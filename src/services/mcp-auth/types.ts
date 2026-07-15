/**
 * McpAuth Service - Types
 *
 * Public contract for the OAuth 2.0 (Authorization Code + PKCE)
 * authentication flow used to obtain tokens for MCP servers.
 */

import type { ToolDefinition } from '../../pkg/types.js';

/**
 * Input parameters for invoking the McpAuth tool.
 */
export interface McpAuthInput {
  /** MCP server URL acting as the OAuth audience / resource indicator. */
  server_url: string;
  /** OAuth client identifier issued by the authorization server. */
  client_id: string;
  /** Whitelisted localhost redirect URI registered for this client. */
  redirect_uri: string;
  /** OAuth authorization endpoint (must be https in production). */
  auth_endpoint: string;
  /** OAuth token endpoint used for code exchange and refresh. */
  token_endpoint: string;
  /** Scopes requested during authorization. */
  scopes: string[];
}

/**
 * Resolved runtime session state for an in-flight OAuth flow.
 *
 * Holds the cryptographic material that links a callback to a single
 * authorization request (state + PKCE verifier).
 */
export interface McpAuthSession {
  /** Cryptographically random opaque value bound to the user agent. */
  state: string;
  /** PKCE code_verifier (43-128 chars). */
  code_verifier: string;
  /** PKCE code_challenge derived from code_verifier (S256, base64url). */
  code_challenge: string;
  /** Issued access token. */
  access_token: string;
  /** Optional refresh token (omitted if not granted). */
  refresh_token?: string;
  /** Granted scope set (space delimited per RFC 6749). */
  scope?: string;
  /** Token type (typically "Bearer"). */
  token_type: string;
  /** Expiration in seconds from issuance (per RFC 6749). */
  expires_in: number;
  /** Absolute epoch milliseconds when the access token expires. */
  expires_at: number;
  /** Echo of server_url for storage keying. */
  server_url: string;
  /** Echo of client_id. */
  client_id: string;
}

/**
 * Discriminated result for token exchange calls. Every error is preserved
 * with its provider message; nothing is silently swallowed.
 */
export type TokenExchangeResult =
  | { ok: true; session: McpAuthSession }
  | { ok: false; error: McpAuthError };

export type McpAuthErrorCategory =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_scope'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'access_denied'
  | 'server_error'
  | 'temporarily_unavailable'
  | 'network'
  | 'state_mismatch'
  | 'redirect_uri_rejected'
  | 'timeout'
  | 'io'
  | 'unknown';

export interface McpAuthError {
  category: McpAuthErrorCategory;
  message: string;
  status?: number;
  body?: string;
}

/**
 * Storage handle returned to callers. Token bytes never appear in this
 * handle; only metadata required for the tool result.
 */
export interface StoredCredentialSummary {
  server_url: string;
  client_id: string;
  expires_at: number;
  has_refresh_token: boolean;
  scopes: string[];
  stored_at: number;
}

/**
 * Public service handle for storage operations.
 */
export interface TokenStore {
  save(session: McpAuthSession): Promise<void>;
  load(serverUrl: string, clientId: string): Promise<McpAuthSession | null>;
  remove(serverUrl: string, clientId: string): Promise<void>;
  list(): Promise<StoredCredentialSummary[]>;
  path(): string;
}

/**
 * Type of the registered McpAuth tool (re-exported for convenience).
 */
export type McpAuthTool = ToolDefinition;

/**
 * Localhost hostnames that may be used in redirect_uri values.
 */
export const LOCALHOST_HOSTNAMES = new Set<string>([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);