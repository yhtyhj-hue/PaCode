import type { Transport, FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { retryWithBackoff, RetryAbortError } from './reconnect.js';
import { createTimeoutFetch } from './sse-transport.js';
import { buildHttpTransport } from './transport-builder.js';
import type { McpHttpOptions } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export async function createHttpTransport(
  url: string | URL,
  options: McpHttpOptions = {},
): Promise<Transport> {
  const transport = buildHttpTransport(url, options);

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

export { RetryAbortError };
