/**
 * WebFetch service types
 *
 * Public contract for the WebFetch tool, mirroring the shape that
 * Claude Code's WebFetchTool exposes. Kept narrow on purpose: callers
 * only see what they need to register and consume the tool.
 */

import type { PermissionMode, ToolResult } from '../../pkg/types.js';

export interface WebFetchInput {
  url: string;
  prompt?: string;
}

export interface WebFetchOptions {
  /** Request timeout in milliseconds. Defaults to 10_000. */
  timeoutMs?: number;
  /** Maximum response body size in bytes. Defaults to 5_242_880 (5 MiB). */
  maxBytes?: number;
  /** Override the User-Agent header. Defaults to "pacode-web-fetch/1.0". */
  userAgent?: string;
  /** Maximum number of redirects to follow. Defaults to 3. */
  maxRedirects?: number;
  /** AbortSignal forwarded to the underlying fetch. */
  signal?: AbortSignal;
  /** Optional prompt that the caller wants answered from the page. */
  prompt?: string;
}

export type WebFetchErrorKind =
  | 'network'
  | 'http_status'
  | 'timeout'
  | 'oversized'
  | 'invalid_url'
  | 'redirect_loop';

export interface WebFetchError {
  kind: WebFetchErrorKind;
  message: string;
  status?: number;
  url?: string;
}

export interface SanitizationWarning {
  kind: string;
  detail: string;
}

export interface WebFetchOutput {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  text: string;
  bytes: number;
  warnings: SanitizationWarning[];
  sanitized: boolean;
}

export type { PermissionMode, ToolResult };