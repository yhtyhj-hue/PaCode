import { describe, it, expect, afterEach } from 'vitest';
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
        name: 'sse-server',
        type: 'sse',
        url: 'http://localhost:9999',
      })
    ).rejects.toThrow(/Unsupported MCP transport/);
  });

  it('callTool returns error when server not connected', async () => {
    const client = new MCPClient();
    const result = await client.callTool('missing', 'tool', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not connected');
  });

  it('disconnect is safe when server was never connected', async () => {
    const client = new MCPClient();
    await expect(client.disconnect('ghost')).resolves.toBeUndefined();
  });
});
