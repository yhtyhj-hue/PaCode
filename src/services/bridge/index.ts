/**
 * K5: Bridge 远程会话 — 产品面延期；提供状态契约避免谎称已支持
 */

export const BRIDGE_CONTRACT = 'bridge/v0' as const;

export type BridgeStatus = 'unavailable' | 'deferred';

export interface BridgeStatusReport {
  contract: typeof BRIDGE_CONTRACT;
  status: BridgeStatus;
  message: string;
  alternatives: string[];
}

/** Bridge 远程会话尚未实现；引导用户用 MCP sse/http */
export function getBridgeStatus(): BridgeStatusReport {
  return {
    contract: BRIDGE_CONTRACT,
    status: 'deferred',
    message:
      'Bridge remote sessions are not implemented yet (ROADMAP K5 deferred product surface).',
    alternatives: [
      'Configure remote MCP in ~/.paude/mcp.json with type "sse" or "http" + url',
      'Use McpAuth tool for OAuth, then reconnect MCP',
      'Use /mcp to inspect local MCP connections',
    ],
  };
}

export function formatBridgeStatus(report: BridgeStatusReport = getBridgeStatus()): string {
  return [
    `Bridge status: ${report.status}`,
    report.message,
    '',
    'Alternatives:',
    ...report.alternatives.map((a) => `- ${a}`),
    '',
    `contract=${report.contract}`,
  ].join('\n');
}
