/**
 * MCP 服务器配置校验 — 拦截 shell 命令误配为 MCP
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

function baseCommandName(command: string): string {
  const token = command.trim().split(/\s+/)[0] ?? '';
  const base = token.includes('/') ? (token.split('/').pop() ?? token) : token;
  return base.toLowerCase();
}

/** 返回错误信息；合法则 null */
export function validateMcpServerEntry(entry: McpServerEntry): string | null {
  const transport = entry.type ?? 'stdio';

  if (transport !== 'stdio') {
    return `Transport "${transport}" is not supported yet (use stdio)`;
  }

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
