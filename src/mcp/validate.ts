/**
 * MCP 服务器配置校验 — 拦截 shell 命令误配；放行 stdio/sse/http（K5）
 */

import { McpServerEntry } from './config.js';

/** 常见 shell 内置/工具，不能作为 MCP stdio 进程 */
const NON_MCP_COMMANDS = new Set([
  'echo',
  'cat',
  'ls',
  'pwd',
  'whoami',
  'date',
  'uname',
  'printf',
  'true',
  'false',
  'cd',
  'mkdir',
  'rm',
  'cp',
  'mv',
  'grep',
  'find',
  'head',
  'tail',
  'wc',
  'which',
  'env',
  'export',
  'source',
  'bash',
  'sh',
  'zsh',
]);

const SUPPORTED_TRANSPORTS = new Set(['stdio', 'sse', 'http']);

function baseCommandName(command: string): string {
  const token = command.trim().split(/\s+/)[0] ?? '';
  const base = token.includes('/') ? (token.split('/').pop() ?? token) : token;
  return base.toLowerCase();
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 返回错误信息；合法则 null */
export function validateMcpServerEntry(entry: McpServerEntry): string | null {
  const transport = entry.type ?? 'stdio';

  if (!SUPPORTED_TRANSPORTS.has(transport)) {
    if (transport === 'websocket') {
      return (
        'Transport "websocket" is deferred (no MCP SDK WebSocket client). ' +
        'Use type "sse" or "http" with a url.'
      );
    }
    return `Unsupported MCP transport: "${transport}" (use stdio, sse, or http)`;
  }

  if (transport === 'stdio') {
    const command = entry.command?.trim();
    if (!command) {
      return 'stdio MCP server requires a command';
    }

    const base = baseCommandName(command);
    if (NON_MCP_COMMANDS.has(base)) {
      return (
        `"${command}" is a shell utility, not an MCP server. ` +
        'MCP needs a long-running process that speaks JSON-RPC over stdio ' +
        '(e.g. npx -y @modelcontextprotocol/server-filesystem /path).'
      );
    }
    return null;
  }

  // sse / http
  const url = entry.url?.trim();
  if (!url) {
    return `${transport} MCP server requires a url`;
  }
  if (!isHttpUrl(url)) {
    return `${transport} MCP server url must be http(s)://…`;
  }
  if (entry.headers) {
    for (const [k, v] of Object.entries(entry.headers)) {
      if (typeof v !== 'string') {
        return `header "${k}" must be a string`;
      }
    }
  }
  return null;
}

/** 连接失败时的可读提示 */
export function formatMcpConnectError(
  _name: string,
  command: string | undefined,
  raw: string
): string {
  if (raw.includes('Connection closed') || raw.includes('ENOENT')) {
    const hint =
      command && validateMcpServerEntry({ type: 'stdio', command })
        ? validateMcpServerEntry({ type: 'stdio', command })
        : 'Ensure the command starts a long-running MCP server, not a one-shot shell utility.';
    return `${raw} (${hint})`;
  }
  return raw;
}
