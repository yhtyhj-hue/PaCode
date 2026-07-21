/**
 * 共享 MCP transport 构造工厂（同步，仅构造不 start）。
 *
 * 收敛 mcp/client.ts 与 mcp-sse-http remote 工具的 SSE/HTTP transport 构造逻辑：
 * headers 合并、timeout fetch 包装、重连参数，全部在此单点实现。
 * 需要连接+重试的调用方（remote 工具）在 build 之后自行 start()+retryWithBackoff。
 * client.connect() 会自行 start()，因此只需 build。
 */
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createTimeoutFetch } from './sse-transport.js';
import type { McpHttpOptions, McpSseOptions } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export function buildSseTransport(url: string | URL, options: McpSseOptions = {}): Transport {
  const target = toUrl(url);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  return new SSEClientTransport(target, {
    eventSourceInit: options.eventSourceInit,
    requestInit: mergeRequestInit(options),
    fetch: createTimeoutFetch(options.fetch, timeoutMs, options.signal),
  });
}

export function buildHttpTransport(url: string | URL, options: McpHttpOptions = {}): Transport {
  const target = toUrl(url);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  return new StreamableHTTPClientTransport(target, {
    requestInit: mergeRequestInit(options),
    fetch: createTimeoutFetch(options.fetch, timeoutMs, options.signal),
    sessionId: options.sessionId,
    reconnectionOptions: {
      initialReconnectionDelay: options.baseDelayMs ?? 500,
      maxReconnectionDelay: options.maxDelayMs ?? 8_000,
      reconnectionDelayGrowFactor: 2,
      maxRetries: Math.max(0, (options.maxAttempts ?? 3) - 1),
    },
  });
}

function mergeRequestInit(options: McpSseOptions | McpHttpOptions): RequestInit {
  const headers = new Headers(options.requestInit?.headers);
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  return { ...options.requestInit, headers, signal: options.signal };
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
