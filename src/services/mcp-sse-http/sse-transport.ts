import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport, FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { retryWithBackoff, RetryAbortError } from './reconnect.js';
import type { McpSseOptions } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export async function createSseTransport(
  url: string | URL,
  options: McpSseOptions = {},
): Promise<Transport> {
  const target = toUrl(url);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const requestInit = createRequestInit(options, timeoutMs);
  const fetchImpl = createTimeoutFetch(options.fetch, timeoutMs, options.signal);
  const transport = new SSEClientTransport(target, {
    eventSourceInit: options.eventSourceInit,
    requestInit,
    fetch: fetchImpl,
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

export function createTimeoutFetch(
  baseFetch: FetchLike | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): FetchLike {
  const fetchImpl = baseFetch ?? fetch;
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const forwardAbort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error: unknown) {
      if (controller.signal.aborted && signal?.aborted) {
        throw new RetryAbortError('MCP request aborted', signal.reason);
      }
      if (controller.signal.aborted) {
        throw new Error(`MCP request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    }
  };
}

function createRequestInit(options: McpSseOptions, timeoutMs: number): RequestInit {
  const headers = new Headers(options.requestInit?.headers);
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  return {
    ...options.requestInit,
    headers,
    signal: options.signal,
    // The SDK fetch wrapper enforces the wall-clock timeout. Keep this field for
    // custom EventSource implementations that inspect RequestInit directly.
    ...(timeoutMs > 0 ? {} : {}),
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
