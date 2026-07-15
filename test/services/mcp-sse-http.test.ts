import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => {
  const sseInstances: MockTransport[] = [];
  const httpInstances: MockTransport[] = [];
  const clientInstances: MockClient[] = [];

  class MockTransport {
    readonly url: URL;
    readonly options: Record<string, unknown>;
    readonly start = vi.fn(async () => undefined);
    readonly close = vi.fn(async () => undefined);
    readonly send = vi.fn(async () => undefined);
    sessionId: string | undefined;

    constructor(url: URL, options: Record<string, unknown> = {}) {
      this.url = url;
      this.options = options;
    }
  }

  class MockSseTransport extends MockTransport {
    constructor(url: URL, options: Record<string, unknown> = {}) {
      super(url, options);
      sseInstances.push(this);
    }
  }

  class MockHttpTransport extends MockTransport {
    constructor(url: URL, options: Record<string, unknown> = {}) {
      super(url, options);
      this.sessionId = options.sessionId as string | undefined;
      httpInstances.push(this);
    }
  }

  class MockClient {
    readonly connect = vi.fn(async () => undefined);
    readonly ping = vi.fn(async () => ({}));
    readonly close = vi.fn(async () => undefined);

    constructor() {
      clientInstances.push(this);
    }
  }

  return {
    MockClient,
    MockHttpTransport,
    MockSseTransport,
    MockTransport,
    clientInstances,
    httpInstances,
    sseInstances,
  };
});

type MockTransport = InstanceType<typeof sdkMocks.MockTransport>;
type MockClient = InstanceType<typeof sdkMocks.MockClient>;

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: sdkMocks.MockSseTransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: sdkMocks.MockHttpTransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: sdkMocks.MockClient,
}));

import {
  McpHttpTool,
  McpSseTool,
  RetryAbortError,
  calculateBackoffDelay,
  createHttpTransport,
  createSseTransport,
  isRetryableError,
  isRetryableStatus,
  registerMcpRemoteTools,
  retryWithBackoff,
} from '../../src/services/mcp-sse-http/index.js';
import { PermissionMode } from '../../src/pkg/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';

describe('MCP SSE and Streamable HTTP transports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMocks.sseInstances.length = 0;
    sdkMocks.httpInstances.length = 0;
    sdkMocks.clientInstances.length = 0;
  });

  it('creates and starts an SSE transport', async () => {
    const transport = await createSseTransport('https://mcp.example/sse');

    expect(transport).toBe(sdkMocks.sseInstances[0]);
    expect(sdkMocks.sseInstances[0]?.url.href).toBe('https://mcp.example/sse');
    expect(sdkMocks.sseInstances[0]?.start).toHaveBeenCalledOnce();
  });

  it('creates and starts a Streamable HTTP transport with session state', async () => {
    const transport = await createHttpTransport('https://mcp.example/mcp', {
      sessionId: 'session-123',
    });

    expect(transport).toBe(sdkMocks.httpInstances[0]);
    expect(sdkMocks.httpInstances[0]?.sessionId).toBe('session-123');
    expect(sdkMocks.httpInstances[0]?.start).toHaveBeenCalledOnce();
  });

  it.each([
    ['SSE', createSseTransport, () => sdkMocks.sseInstances[0]],
    ['HTTP', createHttpTransport, () => sdkMocks.httpInstances[0]],
  ] as const)('passes headers to the %s SDK transport', async (_name, factory, instance) => {
    await factory('https://mcp.example/mcp', {
      headers: { authorization: 'Bearer secret', 'x-tenant': 'tenant-a' },
    });

    const requestInit = instance()?.options.requestInit as RequestInit;
    const headers = new Headers(requestInit.headers);
    expect(headers.get('authorization')).toBe('Bearer secret');
    expect(headers.get('x-tenant')).toBe('tenant-a');
  });

  it('injects an AbortSignal into fetch and enforces timeout', async () => {
    vi.useFakeTimers();
    const baseFetch = vi.fn(
      async (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    await createHttpTransport('https://mcp.example/mcp', { fetch: baseFetch, timeoutMs: 25 });
    const fetchImpl = sdkMocks.httpInstances[0]?.options.fetch as (
      url: string | URL,
      init?: RequestInit,
    ) => Promise<Response>;

    const request = fetchImpl('https://mcp.example/mcp');
    const rejectedRequest = expect(request).rejects.toThrow('MCP request timed out after 25ms');
    await vi.advanceTimersByTimeAsync(25);

    await rejectedRequest;
    expect(baseFetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    vi.useRealTimers();
  });

  it.each([408, 429])('retries retryable HTTP %i errors', async (status) => {
    const operation = vi.fn().mockRejectedValueOnce({ status }).mockResolvedValue('connected');

    const result = await retryWithBackoff(operation, {
      maxAttempts: 2,
      sleep: async () => undefined,
      random: () => 0.5,
    });

    expect(result).toBe('connected');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404])('does not retry HTTP %i errors', async (status) => {
    const error = { status };
    const operation = vi.fn().mockRejectedValue(error);

    await expect(
      retryWithBackoff(operation, { maxAttempts: 3, sleep: async () => undefined }),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledOnce();
  });

  it('retries 5xx errors', async () => {
    const operation = vi.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValue('ok');

    await expect(
      retryWithBackoff(operation, { maxAttempts: 2, sleep: async () => undefined }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('retries network errors', async () => {
    const operation = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValue('ok');

    await expect(
      retryWithBackoff(operation, { maxAttempts: 2, sleep: async () => undefined }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('calculates capped exponential backoff with twenty percent jitter', () => {
    expect(calculateBackoffDelay(0, 500, 8_000, 0.2, () => 0)).toBe(400);
    expect(calculateBackoffDelay(2, 500, 8_000, 0.2, () => 0.5)).toBe(2_000);
    expect(calculateBackoffDelay(8, 500, 8_000, 0.2, () => 1)).toBe(8_000);
  });

  it('treats maxAttempts as total attempts including the initial request', async () => {
    const error = new TypeError('offline');
    const operation = vi.fn().mockRejectedValue(error);

    await expect(
      retryWithBackoff(operation, { maxAttempts: 3, sleep: async () => undefined }),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('normalizes maxAttempts below one to a single attempt', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('failed'));

    await expect(
      retryWithBackoff(operation, { maxAttempts: 0, sleep: async () => undefined }),
    ).rejects.toThrow('failed');
    expect(operation).toHaveBeenCalledOnce();
  });

  it('throws RetryAbortError when aborted before an attempt', async () => {
    const controller = new AbortController();
    controller.abort('cancelled');
    const operation = vi.fn(async () => 'unreachable');

    await expect(retryWithBackoff(operation, { signal: controller.signal })).rejects.toBeInstanceOf(
      RetryAbortError,
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('throws RetryAbortError when aborted during backoff', async () => {
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue(new TypeError('offline'));
    const sleep = vi.fn(async (_delayMs: number, signal?: AbortSignal) => {
      controller.abort('cancelled');
      signal?.throwIfAborted();
    });

    await expect(
      retryWithBackoff(operation, { maxAttempts: 3, signal: controller.signal, sleep }),
    ).rejects.toBeInstanceOf(RetryAbortError);
    expect(operation).toHaveBeenCalledOnce();
  });

  it('classifies retryable statuses and abort errors', () => {
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(409)).toBe(false);
    expect(isRetryableError(new RetryAbortError())).toBe(false);
  });

  it('registers both remote MCP tool definitions with required metadata', () => {
    const registry = new ToolRegistry();

    registerMcpRemoteTools(registry);

    expect(registry.list()).toEqual([McpSseTool, McpHttpTool]);
    expect(McpSseTool.permissionMode).toBe(PermissionMode.DEFAULT);
    expect(McpHttpTool.permissionMode).toBe(PermissionMode.DEFAULT);
    expect(McpSseTool.concurrencySafe).toBe(true);
    expect(McpHttpTool.concurrencySafe).toBe(true);
  });

  it.each([
    ['McpSse', McpSseTool, () => sdkMocks.sseInstances[0]],
    ['McpHttp', McpHttpTool, () => sdkMocks.httpInstances[0]],
  ] as const)('%s execute connects, pings, closes, and returns PingResult', async (_name, tool, transport) => {
    const result = await tool.execute(
      {
        url: 'https://mcp.example/mcp',
        headers: { authorization: 'Bearer token' },
        options: { timeoutMs: 1234, maxAttempts: 2 },
      },
      {} as never,
    );
    const client = sdkMocks.clientInstances[0];

    expect(client?.connect).toHaveBeenCalledWith(transport());
    expect(client?.ping).toHaveBeenCalledWith({ timeout: 1234 });
    expect(client?.close).toHaveBeenCalledOnce();
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain('PingResult');
  });
});
