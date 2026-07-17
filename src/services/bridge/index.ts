/**
 * K5 Bridge 远程会话 — 会话中继仍 deferred；
 * v1-partial：展示远程 MCP 清单，避免空壳状态面
 */

import { loadMcpConfig, type McpConfigFile } from '../../mcp/config.js';
import type { MCPServerConnection } from '../../pkg/types.js';

export const BRIDGE_CONTRACT = 'bridge/v1-partial' as const;

export type BridgeStatus = 'unavailable' | 'deferred' | 'partial';

export interface BridgeRemoteServer {
  name: string;
  type: string;
  url?: string;
  connectionStatus?: string;
  toolCount?: number;
}

export interface BridgeStatusReport {
  contract: typeof BRIDGE_CONTRACT;
  status: BridgeStatus;
  message: string;
  alternatives: string[];
  remoteConfigured: BridgeRemoteServer[];
  remoteConnected: number;
}

const REMOTE_TYPES = new Set(['sse', 'http', 'websocket']);

export interface BridgeStatusInput {
  /** 已连接的 MCP（可选；缺省不查 live） */
  connections?: MCPServerConnection[];
  /** 测试注入配置；缺省读 ~/.paude/mcp.json */
  config?: McpConfigFile;
}

/** Bridge 会话未实现；有远程 MCP 配置/连接时 status=partial */
export function getBridgeStatus(input: BridgeStatusInput = {}): BridgeStatusReport {
  const config = input.config ?? loadMcpConfig();
  const connections = input.connections ?? [];
  const byName = new Map(connections.map((c) => [c.name, c]));

  const remoteConfigured: BridgeRemoteServer[] = [];
  for (const [name, entry] of Object.entries(config.servers)) {
    const type = entry.type ?? 'stdio';
    if (!REMOTE_TYPES.has(type)) continue;
    const conn = byName.get(name);
    remoteConfigured.push({
      name,
      type,
      url: entry.url,
      connectionStatus: conn?.status,
      toolCount: conn?.tools.length,
    });
  }

  // 配置未列名但已连接的远程（罕见）也计入 connected
  const remoteConnected = connections.filter((c) => {
    const entry = config.servers[c.name];
    const type = entry?.type ?? 'stdio';
    return REMOTE_TYPES.has(type) && c.status === 'connected';
  }).length;

  const hasRemote = remoteConfigured.length > 0 || remoteConnected > 0;
  return {
    contract: BRIDGE_CONTRACT,
    status: hasRemote ? 'partial' : 'deferred',
    message:
      'Bridge remote sessions are not implemented (no cross-machine session attach). ' +
      'Remote MCP transports below are the supported alternative.',
    alternatives: [
      'Configure remote MCP in ~/.paude/mcp.json with type "sse", "http", or "websocket" + url',
      'Use McpAuth tool for OAuth, then reconnect MCP',
      'Use /mcp for all connections (stdio + remote); /bridge focuses on remote inventory',
    ],
    remoteConfigured,
    remoteConnected,
  };
}

export function formatBridgeStatus(report: BridgeStatusReport = getBridgeStatus()): string {
  const lines = [
    `Bridge status: ${report.status}`,
    report.message,
    '',
  ];
  if (report.remoteConfigured.length === 0) {
    lines.push('Remote MCP: (none configured)');
  } else {
    lines.push(
      `Remote MCP (${report.remoteConfigured.length} configured, ${report.remoteConnected} connected):`
    );
    for (const s of report.remoteConfigured) {
      const live =
        s.connectionStatus != null
          ? ` · ${s.connectionStatus}${s.toolCount != null ? ` · ${s.toolCount} tool(s)` : ''}`
          : '';
      lines.push(`  - ${s.name} · ${s.type}${s.url ? ` · ${s.url}` : ''}${live}`);
    }
  }
  lines.push('', 'Alternatives:');
  for (const a of report.alternatives) {
    lines.push(`- ${a}`);
  }
  lines.push('', `contract=${report.contract}`);
  return lines.join('\n');
}
