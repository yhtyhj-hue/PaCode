/**
 * MCP configuration — ~/.paude/mcp.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { MCPServerConfig } from '../pkg/types.js';

export interface McpServerEntry {
  type?: 'stdio' | 'sse' | 'http' | 'websocket';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface McpConfigFile {
  servers: Record<string, McpServerEntry>;
}

export function getMcpConfigPath(): string {
  return join(homedir(), '.paude', 'mcp.json');
}

export function loadMcpConfig(configPath?: string): McpConfigFile {
  const path = configPath ?? getMcpConfigPath();
  if (!existsSync(path)) return { servers: {} };

  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as McpConfigFile;
    return { servers: raw.servers ?? {} };
  } catch {
    return { servers: {} };
  }
}

/** 持久化 MCP 配置到 ~/.paude/mcp.json */
export function saveMcpConfig(
  config: McpConfigFile,
  configPath?: string
): void {
  const path = configPath ?? getMcpConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
}

export function toServerConfig(name: string, entry: McpServerEntry): MCPServerConfig {
  return {
    name,
    type: entry.type ?? 'stdio',
    command: entry.command,
    args: entry.args,
    env: entry.env,
    url: entry.url,
  };
}
