/**
 * MCP Client - Model Context Protocol via @modelcontextprotocol/sdk
 * Supports stdio / sse / streamableHttp transports (H5: G5 ROADMAP).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  MCPServerConfig,
  MCPServerConnection,
  ConnectionStatus,
  ToolDefinition,
  ToolResult,
  PermissionMode,
} from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';

type AnyTransport =
  | StdioClientTransport
  | SSEClientTransport
  | StreamableHTTPClientTransport;

interface MCPRuntime {
  connection: MCPServerConnection;
  client: Client;
  transport: AnyTransport;
}

export class MCPClient {
  private servers = new Map<string, MCPRuntime>();
  private log: Logger;

  constructor() {
    this.log = new Logger({ prefix: 'MCPClient' });
  }

  async connect(config: MCPServerConfig): Promise<void> {
    if (this.servers.has(config.name)) {
      await this.disconnect(config.name);
    }

    const connection: MCPServerConnection = {
      name: config.name,
      status: 'pending' as ConnectionStatus,
      tools: [],
    };

    try {
      const transport = this.createTransport(config);

      const client = new Client(
        { name: 'pacode', version: '0.1.0' },
        { capabilities: {} }
      );

      await client.connect(transport);

      const toolsResult = await client.listTools({});
      const serverName = config.name;

      connection.tools = (toolsResult.tools ?? []).map((tool) =>
        this.toToolDefinition(serverName, tool.name, tool.description, tool.inputSchema)
      );
      connection.status = 'connected' as ConnectionStatus;

      this.servers.set(config.name, { connection, client, transport });
      this.log.info(`Connected to ${serverName} (${connection.tools.length} tools)`);
    } catch (error) {
      connection.status = 'failed' as ConnectionStatus;
      connection.lastError = error instanceof Error ? error.message : String(error);
      this.log.error(`Failed to connect to ${config.name}:`, error);
      throw error;
    }
  }

  /** Factory: produce the right transport for the configured type. */
  private createTransport(config: MCPServerConfig): AnyTransport {
    switch (config.type) {
      case 'stdio': {
        if (!config.command) {
          throw new Error('stdio MCP server requires command');
        }
        return new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: config.env,
          stderr: 'ignore',
        });
      }
      case 'sse': {
        if (!config.url) {
          throw new Error('sse MCP server requires url');
        }
        return new SSEClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers },
        });
      }
      case 'http': {
        if (!config.url) {
          throw new Error('http MCP server requires url');
        }
        return new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers },
        });
      }
      default: {
        throw new Error(
          `Unsupported MCP transport: ${String(config.type)} (only stdio/sse/http implemented)`
        );
      }
    }
  }

  async disconnect(name: string): Promise<void> {
    const runtime = this.servers.get(name);
    if (!runtime) return;

    try {
      await runtime.client.close();
    } catch (error) {
      this.log.warn(`Error closing MCP client ${name}:`, error);
    }

    try {
      await runtime.transport.close();
    } catch (error) {
      this.log.warn(`Error closing MCP transport ${name}:`, error);
    }

    this.servers.delete(name);
    this.log.info(`Disconnected from ${name}`);
  }

  getConnection(name: string): MCPServerConnection | undefined {
    return this.servers.get(name)?.connection;
  }

  listConnections(): MCPServerConnection[] {
    return Array.from(this.servers.values()).map((r) => r.connection);
  }

  getTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const runtime of this.servers.values()) {
      if (runtime.connection.status === 'connected') {
        tools.push(...runtime.connection.tools);
      }
    }
    return tools;
  }

  /** 调用已连接 MCP 服务器上的工具 */
  async callTool(
    serverName: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<ToolResult> {
    const runtime = this.servers.get(serverName);
    if (!runtime || runtime.connection.status !== 'connected') {
      return {
        content: [{ type: 'text', text: `MCP server not connected: ${serverName}` }],
        isError: true,
      };
    }

    try {
      const result = await runtime.client.callTool({ name: toolName, arguments: input });
      const text = Array.isArray(result.content)
        ? result.content
            .map((block) => ('text' in block ? String(block.text) : JSON.stringify(block)))
            .join('\n')
        : String(result.content ?? '');

      return {
        content: [{ type: 'text', text }],
        isError: Boolean(result.isError),
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }

  private toToolDefinition(
    serverName: string,
    name: string,
    description: string | undefined,
    inputSchema: unknown
  ): ToolDefinition {
    // 闭包绑定 MCPClient 实例；禁止 MCPClient.prototype.callTool.call(this) —
    // tool.execute 的 this 是工具对象，不是 client，会导致 servers Map 丢失。
    const client = this;
    return {
      name: `mcp__${serverName}__${name}`,
      description: description ?? `MCP tool ${name} from ${serverName}`,
      inputSchema: inputSchema ?? { type: 'object', properties: {} },
      concurrencySafe: false,
      permissionMode: PermissionMode.DEFAULT,
      async execute(input) {
        return client.callTool(serverName, name, input as Record<string, unknown>);
      },
    };
  }
}

let instance: MCPClient | null = null;
export function getMCPClient(): MCPClient {
  if (!instance) instance = new MCPClient();
  return instance;
}

export function resetMCPClient(): void {
  instance = null;
}
