import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport, FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { retryWithBackoff, RetryAbortError } from './reconnect.js';
import { createTimeoutFetch } from './sse-transport.js';
import type { McpHttpOptions } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export async function createHttpTransport(
  url: string | URL,
  options: McpHttpOptions = {},
): Promise<Transport> {
  const target = toUrl(url);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const requestInit = createRequestInit(options);
  const fetchImpl = createTimeoutFetch(options.fetch, timeoutMs, options.signal);
  const transport = new StreamableHTTPClientTransport(target, {
    requestInit,
    fetch: fetchImpl,
    sessionId: options.sessionId,
    reconnectionOptions: {
      initialReconnectionDelay: options.baseDelayMs ?? 500,
      maxReconnectionDelay: options.maxDelayMs ?? 8_000,
      reconnectionDelayGrowFactor: 2,
      maxRetries: Math.max(0, (options.maxAttempts ?? 3) - 1),
    },
  });

  await retryWithBackoff(
    async () => {
      await transport.start();
    },
    {
      maxAttempts: options.maxAttempts,
      baseDelayMs: options.baseDelayMs,
      maxDelayMs: options.maxDelayMs,
      signal: options.signal,
    },
  );
  return transport;
}

export function createHttpTimeoutFetch(
  baseFetch: FetchLike | undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): FetchLike {
  return createTimeoutFetch(baseFetch, timeoutMs, signal);
}

function createRequestInit(options: McpHttpOptions): RequestInit {
  const headers = new Headers(options.requestInit?.headers);
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  return {
    ...options.requestInit,
    headers,
    signal: options.signal,
  };
}

function toUrl(url: string | URL): URL {
  return url instanceof URL ? new URL(url.href) : new URL(url);
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (timeoutMs <= 0) {
    throw new RangeError('MCP timeoutMs must be greater than zero');
  }
  return Math.floor(timeoutMs);
}

export { RetryAbortError };
