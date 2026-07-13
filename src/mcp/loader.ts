/**
 * MCP Loader — connect configured servers and register tools into ToolRegistry
 */

import { ToolRegistry } from '../tools/registry.js';
import { MCPServerConnection } from '../pkg/types.js';
import { MCPClient, getMCPClient } from './client.js';
import { loadMcpConfig, toServerConfig } from './config.js';
import { validateMcpServerEntry, formatMcpConnectError } from './validate.js';
import { Logger } from '../pkg/logger/index.js';

const MCP_TOOL_PREFIX = 'mcp__';

export interface McpBootstrapResult {
  connectedCount: number;
  toolCount: number;
  connections: MCPServerConnection[];
  errors: Array<{ name: string; error: string }>;
}

export interface McpBootstrapOptions {
  client?: MCPClient;
  configPath?: string;
  /** 跳过网络连接，仅注册 client 中已有工具 */
  skipConnect?: boolean;
}

/** 从 Registry 移除所有 MCP 工具 */
export function unregisterMcpTools(registry: ToolRegistry): void {
  for (const tool of registry.list()) {
    if (tool.name.startsWith(MCP_TOOL_PREFIX)) {
      registry.unregister(tool.name);
    }
  }
}

/** 将 MCPClient 中的工具注册到 ToolRegistry */
export function registerMcpTools(registry: ToolRegistry, client: MCPClient): number {
  unregisterMcpTools(registry);
  const tools = client.getTools();
  for (const tool of tools) {
    registry.register(tool);
  }
  return tools.length;
}

/** 连接 ~/.paude/mcp.json 中的服务器并注册 MCP 工具 */
export async function bootstrapMcpTools(
  registry: ToolRegistry,
  options: McpBootstrapOptions = {}
): Promise<McpBootstrapResult> {
  const log = new Logger({ prefix: 'MCPLoader' });
  const client = options.client ?? getMCPClient();
  const config = loadMcpConfig(options.configPath);
  const errors: Array<{ name: string; error: string }> = [];

  if (!options.skipConnect) {
    for (const [name, entry] of Object.entries(config.servers)) {
      const validationError = validateMcpServerEntry(entry);
      if (validationError) {
        errors.push({ name, error: validationError });
        log.warn(`Invalid MCP config for ${name}: ${validationError}`);
        continue;
      }

      try {
        await client.connect(toServerConfig(name, entry));
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const message = formatMcpConnectError(name, entry.command, raw);
        errors.push({ name, error: message });
        log.warn(`Failed to connect MCP server ${name}: ${message}`);
      }
    }
  }

  const toolCount = registerMcpTools(registry, client);
  const connections = client.listConnections();
  const connectedCount = connections.filter((c) => c.status === 'connected').length;

  log.info(`MCP bootstrap: ${connectedCount} server(s), ${toolCount} tool(s)`);

  return { connectedCount, toolCount, connections, errors };
}
