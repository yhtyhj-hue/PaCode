/**
 * K5 — MCP sse/http bootstrap path + Bridge deferred status
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ToolRegistry, resetToolRegistry } from '../src/tools/registry.js';
import { bootstrapMcpTools } from '../src/mcp/loader.js';
import { MCPClient, resetMCPClient } from '../src/mcp/client.js';
import { toServerConfig } from '../src/mcp/config.js';
import { mergeMcpAuthHeaders } from '../src/mcp/auth-headers.js';
import { getBridgeStatus, formatBridgeStatus, BRIDGE_CONTRACT } from '../src/services/bridge/index.js';
import type { TokenStore, McpAuthSession } from '../src/services/mcp-auth/index.js';
import { BUILTIN_SLASH_COMMANDS } from '../src/cli/slash-menu.js';

describe('K5 toServerConfig headers', () => {
  it('forwards headers for http entries', () => {
    const cfg = toServerConfig('remote', {
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { 'X-Test': '1' },
    });
    expect(cfg.type).toBe('http');
    expect(cfg.headers?.['X-Test']).toBe('1');
  });
});

describe('K5 bootstrap http/sse connect', () => {
  beforeEach(() => {
    resetMCPClient();
    resetToolRegistry();
  });

  it('connects http server from mcp.json (no longer blocked by validate)', async () => {
    const configDir = join(tmpdir(), `mcp-k5-${Date.now()}`);
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'mcp.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        servers: {
          remote: {
            type: 'http',
            url: 'https://mcp.example/v1',
            headers: { 'X-Api-Key': 'demo' },
          },
        },
      })
    );

    const registry = new ToolRegistry();
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      getTools: () => [],
      listConnections: () => [],
    } as unknown as MCPClient;

    const result = await bootstrapMcpTools(registry, {
      client: mockClient,
      configPath,
    });

    expect(result.errors).toEqual([]);
    expect(mockClient.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'remote',
        type: 'http',
        url: 'https://mcp.example/v1',
        headers: expect.objectContaining({ 'X-Api-Key': 'demo' }),
      })
    );

    if (existsSync(configDir)) rmSync(configDir, { recursive: true, force: true });
  });
});

describe('K5 mergeMcpAuthHeaders', () => {
  it('injects Bearer from token store when missing', async () => {
    const session: McpAuthSession = {
      state: 's',
      code_verifier: 'v'.repeat(43),
      code_challenge: 'c',
      access_token: 'tok-abc',
      token_type: 'Bearer',
      expires_in: 3600,
      expires_at: Date.now() + 3600_000,
      server_url: 'https://mcp.example',
      client_id: 'cid',
    };
    const store: TokenStore = {
      path: () => '/tmp/x',
      save: async () => {},
      load: async () => session,
      remove: async () => {},
      list: async () => [
        {
          server_url: 'https://mcp.example',
          client_id: 'cid',
          expires_at: session.expires_at,
          has_refresh_token: false,
          scopes: [],
          stored_at: Date.now(),
        },
      ],
    };

    const headers = await mergeMcpAuthHeaders(
      'https://mcp.example/v1',
      { 'X-Extra': '1' },
      store
    );
    expect(headers?.Authorization).toBe('Bearer tok-abc');
    expect(headers?.['X-Extra']).toBe('1');
  });

  it('does not override existing Authorization', async () => {
    const store: TokenStore = {
      path: () => '/tmp/x',
      save: async () => {},
      load: async () => null,
      remove: async () => {},
      list: async () => [],
    };
    const headers = await mergeMcpAuthHeaders(
      'https://mcp.example',
      { Authorization: 'Bearer keep-me' },
      store
    );
    expect(headers?.Authorization).toBe('Bearer keep-me');
  });
});

describe('K5 Bridge v1-partial', () => {
  it('reports deferred when no remote MCP configured', () => {
    const status = getBridgeStatus({ config: { servers: {} }, connections: [] });
    expect(status.contract).toBe(BRIDGE_CONTRACT);
    expect(status.status).toBe('deferred');
    expect(formatBridgeStatus(status)).toContain('not implemented');
    expect(formatBridgeStatus(status)).toContain('mcp.json');
    expect(formatBridgeStatus(status)).toContain('bridge/v0-session');
    expect(formatBridgeStatus(status)).toContain('Remote MCP: (none configured)');
  });

  it('reports partial with remote MCP inventory', () => {
    const status = getBridgeStatus({
      config: {
        servers: {
          remote: { type: 'sse', url: 'https://mcp.example/sse' },
          local: { type: 'stdio', command: 'npx' },
        },
      },
      connections: [
        {
          name: 'remote',
          status: 'connected',
          tools: [{ name: 'ping' }] as never,
        },
      ],
    });
    expect(status.status).toBe('partial');
    expect(status.remoteConfigured).toHaveLength(1);
    expect(status.remoteConnected).toBe(1);
    const text = formatBridgeStatus(status);
    expect(text).toContain('remote');
    expect(text).toContain('sse');
    expect(text).toContain('connected');
    expect(text).toContain('sessions are not implemented');
  });

  it('exposes /bridge in slash menu', () => {
    expect(BUILTIN_SLASH_COMMANDS.some((c) => c.command === '/bridge')).toBe(true);
  });
});
