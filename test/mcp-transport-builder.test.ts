/**
 * 收敛 MCP transport 构造：mcp/client.ts 与 remote 工具共享同一 transport 工厂，
 * 消除重复的 SSE/HTTP transport 构造逻辑（headers 合并 + timeout fetch）。
 */
import { describe, it, expect } from 'vitest';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  buildSseTransport,
  buildHttpTransport,
} from '../src/services/mcp-sse-http/transport-builder.js';

describe('MCP transport-builder (shared factory)', () => {
  it('buildSseTransport returns an SSEClientTransport', () => {
    const t = buildSseTransport('https://example.com/sse', {
      headers: { 'X-Test': '1' },
    });
    expect(t).toBeInstanceOf(SSEClientTransport);
  });

  it('buildHttpTransport returns a StreamableHTTPClientTransport', () => {
    const t = buildHttpTransport('https://example.com/mcp', {
      headers: { 'X-Test': '1' },
    });
    expect(t).toBeInstanceOf(StreamableHTTPClientTransport);
  });

  it('buildSseTransport accepts a URL object', () => {
    const t = buildSseTransport(new URL('https://example.com/sse'));
    expect(t).toBeInstanceOf(SSEClientTransport);
  });

  it('buildHttpTransport rejects non-positive timeout', () => {
    expect(() => buildHttpTransport('https://example.com/mcp', { timeoutMs: 0 })).toThrow(
      /greater than zero/i
    );
  });
});
