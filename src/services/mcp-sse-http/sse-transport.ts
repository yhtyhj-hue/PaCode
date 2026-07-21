import type { Transport, FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { retryWithBackoff, RetryAbortError } from './reconnect.js';
import { buildSseTransport } from './transport-builder.js';
import type { McpSseOptions } from './types.js';

export async function createSseTransport(
  url: string | URL,
  options: McpSseOptions = {},
): Promise<Transport> {
  const transport = buildSseTransport(url, options);

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
