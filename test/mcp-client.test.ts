import { describe, it, expect, afterEach, vi } from 'vitest';
import { MCPClient, resetMCPClient } from '../src/mcp/client.js';

describe('MCPClient', () => {
  afterEach(() => {
    resetMCPClient();
  });

  it('starts with no connections', () => {
    const client = new MCPClient();
    expect(client.listConnections()).toEqual([]);
    expect(client.getTools()).toEqual([]);
  });

  it('marks connection failed for invalid stdio command', async () => {
    const client = new MCPClient();
    await expect(
      client.connect({
        name: 'bad-server',
        type: 'stdio',
        command: '__pacode_nonexistent_command__',
        args: [],
      })
    ).rejects.toThrow();

    expect(client.getConnection('bad-server')).toBeUndefined();
  });

  it('rejects unsupported transport types', async () => {
    const client = new MCPClient();
    await expect(
      client.connect({
        name: 'ws-bad',
        type: 'websocket',
      })
    ).rejects.toThrow(/only stdio\/sse\/http implemented/i);
  });

  it('sse transport attempts connection (and fails on bad URL)', async () => {
    // H5: sse is now supported; verify it actually attempts the
    // connection rather than throwing 'Unsupported MCP transport'.
    // (ECONNREFUSED is expected on localhost:9999.)
    const client = new MCPClient();
    await expect(
      client.connect({
        name: 'sse-bad-url',
        type: 'sse',
        url: 'http://127.0.0.1:9999',
      })
    ).rejects.toThrow(); // any network-level error
  });

  it('callTool returns error when server not connected', async () => {
    const client = new MCPClient();
    const result = await client.callTool('missing', 'tool', {});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('not connected');
  });

  it('registered MCP tool execute binds to MCPClient instance', async () => {
    const client = new MCPClient();
    const spy = vi.spyOn(client, 'callTool');
    // 校验 execute 闭包调用 client.callTool（修复前 this 绑错会导致 servers 丢失）
    const tool = (
      client as unknown as {
        toToolDefinition: (
          serverName: string,
          name: string,
          description: string | undefined,
          inputSchema: unknown
        ) => { execute: (input: unknown, ctx: unknown) => Promise<unknown> };
      }
    ).toToolDefinition('svc', 'ping', 'ping', { type: 'object', properties: {} });

    await tool.execute(
      {},
      {
        workingDirectory: process.cwd(),
        sessionState: {},
        hooks: { register() {}, findMatching() { return []; }, execute: async () => ({}) },
      }
    );

    expect(spy).toHaveBeenCalledWith('svc', 'ping', {});
    spy.mockRestore();
  });

  it('disconnect is safe when server was never connected', async () => {
    const client = new MCPClient();
    await expect(client.disconnect('ghost')).resolves.toBeUndefined();
  });
});
