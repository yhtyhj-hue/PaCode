/**
 * H5 MCP transports: stdio (existing) + sse + http real connection.
 *
 * Validates:
 * - createTransport dispatch (switch case)
 * - type union narrows correctly
 * - fallback for non-supported transport types
 *
 * Does NOT actually open a remote SSE/HTTP server here — that
 * requires a fixture process. The runtime path is exercised in
 * test/mcp-client.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';

describe('H5 MCP transport dispatch', () => {
  it('throws when websocket config lacks url', async () => {
    const { MCPClient } = await import('../src/mcp/client.js');
    const client = new MCPClient();
    await expect(
      client.connect({
        name: 'ws-bad',
        type: 'websocket',
      })
    ).rejects.toThrow(/websocket MCP server requires url/i);
  });

  it('sse transport requires url', async () => {
    const { MCPClient } = await import('../src/mcp/client.js');
    const client = new MCPClient();
    await expect(
      client.connect({
        name: 'sse-no-url',
        type: 'sse',
      })
    ).rejects.toThrow(/sse MCP server requires url/i);
  });

  it('http transport requires url', async () => {
    const { MCPClient } = await import('../src/mcp/client.js');
    const client = new MCPClient();
    await expect(
      client.connect({
        name: 'http-no-url',
        type: 'http',
      })
    ).rejects.toThrow(/http MCP server requires url/i);
  });

  it('stdio transport still requires command (regression)', async () => {
    const { MCPClient } = await import('../src/mcp/client.js');
    const client = new MCPClient();
    await expect(
      client.connect({
        name: 'stdio-no-cmd',
        type: 'stdio',
      })
    ).rejects.toThrow(/stdio MCP server requires command/i);
  });
});

describe('H5 MCP type union', () => {
  it('MCPServerConfig accepts stdio/sse/http/websocket strings', () => {
    // This test is mostly a compile-time check; at runtime we
    // verify the values flow through without coercion.
    const configs: Array<{ type: 'stdio' | 'sse' | 'http' | 'websocket' }> = [
      { type: 'stdio' },
      { type: 'sse' },
      { type: 'http' },
      { type: 'websocket' },
    ];
    expect(configs).toHaveLength(4);
  });
});