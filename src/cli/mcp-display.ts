/**
 * /mcp 纯文本报告 — REPL / TUI 共用
 */

import type { MCPServerConnection } from '../pkg/types.js';
import { getMCPClient } from '../mcp/client.js';

export function listMcpConnections(
  injected?: MCPServerConnection[]
): MCPServerConnection[] {
  // undefined → live client；显式 [] 表示无连接
  if (injected !== undefined) return injected;
  try {
    return getMCPClient().listConnections();
  } catch {
    return [];
  }
}

export function formatMcpReportLines(
  connections: MCPServerConnection[] = listMcpConnections()
): string[] {
  const lines = ['MCP Servers'];
  if (connections.length === 0) {
    lines.push('  No MCP servers connected');
    lines.push('  Configure with: pacode mcp add <name> <command>');
    return lines;
  }
  for (const conn of connections) {
    lines.push(`  ${conn.name} · ${conn.status} · ${conn.tools.length} tool(s)`);
    if (conn.lastError) {
      lines.push(`    Error: ${conn.lastError}`);
    }
  }
  return lines;
}
