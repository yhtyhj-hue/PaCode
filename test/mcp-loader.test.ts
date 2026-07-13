import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import {
  bootstrapMcpTools,
  registerMcpTools,
  unregisterMcpTools,
} from '../src/mcp/loader.js';
import { MCPClient, resetMCPClient } from '../src/mcp/client.js';
import { setupToolRegistry } from '../src/tools/setup.js';
import { QueryEngine } from '../src/agent/engine.js';
import { PermissionMode } from '../src/pkg/types.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetToolRegistry } from '../src/tools/registry.js';

describe('MCP Loader', () => {
  beforeEach(() => {
    resetMCPClient();
    resetToolRegistry();
  });

  it('registers MCP tools into ToolRegistry', async () => {
    const registry = new ToolRegistry();
    registerCorePlaceholder(registry);

    const mockTool = {
      name: 'mcp__demo__search',
      description: 'search docs',
      inputSchema: { type: 'object', properties: {} },
      concurrencySafe: false,
      permissionMode: PermissionMode.DEFAULT,
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    };

    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      getTools: () => [mockTool],
      listConnections: () => [
        { name: 'demo', status: 'connected' as const, tools: [mockTool] },
      ],
    } as unknown as MCPClient;

    const result = await bootstrapMcpTools(registry, {
      client: mockClient,
      skipConnect: true,
    });

    expect(result.toolCount).toBe(1);
    expect(registry.has('mcp__demo__search')).toBe(true);
    expect(registry.has('Bash')).toBe(true);
  });

  it('replaces stale MCP tools on re-bootstrap', () => {
    const registry = new ToolRegistry();
    registry.register(createNamedTool('mcp__old__a'));
    registry.register(createNamedTool('mcp__old__b'));
    registry.register(createNamedTool('Bash'));

    unregisterMcpTools(registry);
    expect(registry.list()).toHaveLength(1);
    expect(registry.has('Bash')).toBe(true);
  });

  it('loads config and attempts connect for each server', async () => {
    const configDir = join(tmpdir(), `mcp-cfg-${Date.now()}`);
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'mcp.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        servers: {
          srv1: { type: 'stdio', command: 'echo', args: ['hi'] },
        },
      })
    );

    const registry = new ToolRegistry();
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      getTools: () => [],
      listConnections: () => [],
    } as unknown as MCPClient;

    await bootstrapMcpTools(registry, { client: mockClient, configPath });

    expect(mockClient.connect).toHaveBeenCalledOnce();
    expect(mockClient.connect).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'srv1', command: 'echo' })
    );

    if (existsSync(configDir)) rmSync(configDir, { recursive: true, force: true });
  });

  it('setupToolRegistry exposes MCP tools to QueryEngine', async () => {
    const mockTool = createNamedTool('mcp__x__ping');
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      getTools: () => [mockTool],
      listConnections: () => [{ name: 'x', status: 'connected' as const, tools: [mockTool] }],
    } as unknown as MCPClient;

    const registry = new ToolRegistry();
    registerCorePlaceholder(registry);

    registerMcpTools(registry, mockClient);

    const engine = new QueryEngine({ apiKey: 'k', toolRegistry: registry });
    expect(engine.getToolRegistry().has('mcp__x__ping')).toBe(true);
  });

  it('setupToolRegistry registers core + mcp together', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      getTools: () => [createNamedTool('mcp__srv__tool')],
      listConnections: () => [],
    } as unknown as MCPClient;

    const registry = new ToolRegistry();
    const { registry: out, hookRegistry, mcp } = await setupToolRegistry({
      registry,
      connectMcp: false,
    });
    registerMcpTools(out, mockClient);

    expect(out.has('Bash')).toBe(true);
    expect(out.has('mcp__srv__tool')).toBe(true);
    expect(hookRegistry).toBeTruthy();
    expect(mcp).toBeNull();
  });
});

function registerCorePlaceholder(registry: ToolRegistry): void {
  registry.register(createNamedTool('Bash'));
}

function createNamedTool(name: string) {
  return {
    name,
    description: name,
    inputSchema: {},
    concurrencySafe: name !== 'Bash',
    permissionMode: PermissionMode.DEFAULT,
    async execute() {
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
}
