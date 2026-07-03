/**
 * MCP Client - Model Context Protocol
 */

import {
  MCPServerConfig,
  MCPServerConnection,
  ConnectionStatus,
  ToolDefinition,
} from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';

export class MCPClient {
  private servers = new Map<string, MCPServerConnection>();
  private log: Logger;

  constructor() {
    this.log = new Logger({ prefix: 'MCPClient' });
  }

  async connect(config: MCPServerConfig): Promise<void> {
    const connection: MCPServerConnection = {
      name: config.name,
      status: 'pending' as ConnectionStatus,
      tools: [],
    };

    this.servers.set(config.name, connection);

    try {
      // Simplified MCP client - actual implementation would use @modelcontextprotocol/sdk
      this.log.info(`Connecting to ${config.name}...`);
      connection.status = 'connected' as ConnectionStatus;
    } catch (error) {
      connection.status = 'failed' as ConnectionStatus;
      connection.lastError = error instanceof Error ? error.message : String(error);
      this.log.error(`Failed to connect to ${config.name}:`, error);
      throw error;
    }
  }

  async disconnect(name: string): Promise<void> {
    if (this.servers.has(name)) {
      this.servers.delete(name);
      this.log.info(`Disconnected from ${name}`);
    }
  }

  getConnection(name: string): MCPServerConnection | undefined {
    return this.servers.get(name);
  }

  listConnections(): MCPServerConnection[] {
    return Array.from(this.servers.values());
  }

  getTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const conn of this.servers.values()) {
      if (conn.status === 'connected') {
        tools.push(...conn.tools);
      }
    }
    return tools;
  }
}

let instance: MCPClient | null = null;
export function getMCPClient(): MCPClient {
  if (!instance) instance = new MCPClient();
  return instance;
}
