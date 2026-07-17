/**
 * K5 Bridge — v1-partial 远程 MCP 清单 + bridge/v1-local 本机会话中继
 */

import { loadMcpConfig, type McpConfigFile } from '../../mcp/config.js';
import type { MCPServerConnection } from '../../pkg/types.js';

export const BRIDGE_CONTRACT = 'bridge/v1-partial' as const;

export type BridgeStatus = 'unavailable' | 'deferred' | 'partial' | 'local';

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
  connections?: MCPServerConnection[];
  config?: McpConfigFile;
}

/** Bridge：本机会话可用；有远程 MCP 时 status=partial */
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

  const remoteConnected = connections.filter((c) => {
    const entry = config.servers[c.name];
    const type = entry?.type ?? 'stdio';
    return REMOTE_TYPES.has(type) && c.status === 'connected';
  }).length;

  const hasRemote = remoteConfigured.length > 0 || remoteConnected > 0;
  return {
    contract: BRIDGE_CONTRACT,
    status: hasRemote ? 'partial' : 'local',
    message:
      'Local session relay is available (bridge/v1-local). ' +
      'Cross-public-internet SaaS relay is out of scope. ' +
      (hasRemote
        ? 'Remote MCP transports below are listed.'
        : 'Configure remote MCP for cross-machine tools.'),
    alternatives: [
      'pacode bridge serve  — WebSocket relay on loopback',
      '/bridge session list|attach <id> — local .paude/sessions',
      'Remote MCP: ~/.paude/mcp.json type sse|http|websocket + url',
    ],
    remoteConfigured,
    remoteConnected,
  };
}

export function formatBridgeStatus(report: BridgeStatusReport = getBridgeStatus()): string {
  const lines = [`Bridge status: ${report.status}`, report.message, ''];
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
  lines.push(
    '',
    'Session protocol: bridge/v1-local (list|attach|detach|status).',
    'Try: /bridge session list  |  pacode bridge serve',
    '',
    `contract=${report.contract}`
  );
  return lines.join('\n');
}

export {
  BRIDGE_SESSION_CONTRACT,
  bridgeSessionOp,
  formatBridgeSessionOp,
  parseBridgeSessionArgs,
  listLocalSessionRefs,
  loadLocalSession,
  setAttachedSessionId,
  getAttachedSessionId,
  type BridgeSessionAction,
  type BridgeSessionRef,
  type BridgeSessionRequest,
  type BridgeSessionOpResult,
} from './session.js';

export {
  BRIDGE_RELAY_CONTRACT,
  startSessionRelayServer,
  type RelayServerOptions,
  type RelayServerHandle,
} from './relay.js';
