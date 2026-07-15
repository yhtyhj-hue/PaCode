import type { EventSourceInit } from 'eventsource';
import type { FetchLike, Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export interface McpRetryOptions {
  /** Total attempts, including the initial request. Defaults to 3. */
  maxAttempts?: number;
  /** Initial retry delay in milliseconds. Defaults to 500. */
  baseDelayMs?: number;
  /** Maximum retry delay in milliseconds. Defaults to 8 seconds. */
  maxDelayMs?: number;
  /** Random delay variation as a fraction. Defaults to 0.2 (±20%). */
  jitterRatio?: number;
  /** Abort the current attempt and all future retries. */
  signal?: AbortSignal;
}

export interface McpTransportOptions extends McpRetryOptions {
  /** Per-request wall-clock timeout. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Headers applied to every request. */
  headers?: RequestInit['headers'];
  /** Custom fetch implementation, useful for tests and hosts without global fetch. */
  fetch?: FetchLike;
  /** Additional RequestInit values passed to the SDK transport. */
  requestInit?: RequestInit;
}

export interface McpSseOptions extends McpTransportOptions {
  /** Additional options for the SDK's EventSource implementation. */
  eventSourceInit?: EventSourceInit;
}

export interface McpHttpOptions extends McpTransportOptions {
  /** Continue an existing Streamable HTTP session. */
  sessionId?: string;
}

export interface McpRemoteToolInput {
  url: string;
  headers?: Record<string, string>;
  options?: McpRemoteToolOptions;
}

export interface McpRemoteToolOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export type McpTransport = Transport;

export interface McpTransportFactory {
  (url: string | URL, options?: McpTransportOptions): Promise<Transport>;
}
