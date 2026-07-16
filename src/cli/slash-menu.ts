/**
 * REPL 斜杠命令菜单 — Claude Code 风格输入 `/` 时显示命令列表
 */

import { getUiWidth, visibleWidth } from './repl-ui.js';

const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

export interface SlashMenuEntry {
  command: string;
  description: string;
}

/** 内置 slash 命令（与 repl.ts handleSlashCommand 对齐；不对齐 CC 101） */
export const BUILTIN_SLASH_COMMANDS: SlashMenuEntry[] = [
  { command: '/help', description: 'Show help and available commands' },
  { command: '/brief', description: 'Project brief (CLAUDE.md / package.json / README)' },
  { command: '/clear', description: 'Clear conversation history' },
  { command: '/reset', description: 'Alias for /clear' },
  { command: '/compact', description: 'Compress conversation to reduce tokens' },
  { command: '/context', description: 'Show context usage' },
  { command: '/status', description: 'Show session info' },
  { command: '/doctor', description: 'Run local health checks' },
  { command: '/diff', description: 'Show git status and diff --stat (read-only)' },
  { command: '/cost', description: 'Show token usage and cost' },
  { command: '/memory', description: 'Show memory file locations' },
  { command: '/mcp', description: 'Show MCP server connections' },
  { command: '/permissions', description: 'Show permission rules' },
  { command: '/providers', description: 'List API providers' },
  { command: '/mode', description: 'Change permission mode' },
  { command: '/model', description: 'Show or change model' },
  { command: '/style', description: 'Switch output style (default/cost/full/minimal)' },
  { command: '/agents', description: 'List subagents, tasks, and teams' },
  { command: '/plan', description: 'Create or manage implementation plans' },
  { command: '/resume', description: 'Resume a saved session' },
  { command: '/rewind', description: 'Rewind workspace to a checkpoint' },
  { command: '/init', description: 'Initialize project with CLAUDE.md' },
  { command: '/exit', description: 'Exit the CLI' },
  { command: '/quit', description: 'Alias for /exit' },
];

/** 按输入过滤 slash 命令 */
export function filterSlashCommands(
  input: string,
  extra: SlashMenuEntry[] = []
): SlashMenuEntry[] {
  if (!input.startsWith('/')) return [];

  const all = [...BUILTIN_SLASH_COMMANDS, ...extra];
  const seen = new Set<string>();
  const unique = all.filter((entry) => {
    if (seen.has(entry.command)) return false;
    seen.add(entry.command);
    return true;
  });

  if (input === '/') return unique;

  const query = input.split(/\s+/)[0]!.toLowerCase();
  return unique.filter((entry) => entry.command.toLowerCase().startsWith(query));
}

/** 双列菜单行（命令 + 描述） */
export function formatSlashMenu(
  entries: SlashMenuEntry[],
  maxRows = 24,
  width = getUiWidth()
): string[] {
  if (entries.length === 0) return [];

  const shown = entries.slice(0, maxRows);
  const cmdWidth = Math.min(
    32,
    Math.max(14, ...shown.map((e) => visibleWidth(e.command))) + 2
  );

  const lines = shown.map((entry) => {
    const descMax = Math.max(10, width - cmdWidth - 2);
    let desc = entry.description;
    if (desc.length > descMax) desc = `${desc.slice(0, descMax - 3)}...`;
    const cmdCol = `${CYAN}${entry.command.padEnd(cmdWidth)}${RESET}`;
    return `${cmdCol}${DIM}${desc}${RESET}`;
  });

  if (entries.length > maxRows) {
    lines.push(`${DIM}  ... and ${entries.length - maxRows} more — type to filter${RESET}`);
  }

  return lines;
}

/** Tab 补全：唯一匹配直接补全，多匹配补公共前缀 */
export function completeSlashCommand(
  input: string,
  extra: SlashMenuEntry[] = []
): string | null {
  if (!input.startsWith('/')) return null;

  const matches = filterSlashCommands(input, extra);
  if (matches.length === 0) return null;

  const base = input.split(/\s+/)[0]!;
  if (matches.length === 1) {
    const cmd = matches[0]!.command;
    const rest = input.slice(base.length);
    return cmd + rest;
  }

  const names = matches.map((m) => m.command);
  let prefix = names[0]!;
  for (const name of names.slice(1)) {
    while (!name.toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return null;
    }
    let i = prefix.length;
    while (i <= name.length) {
      const candidate = name.slice(0, i);
      if (names.every((n) => n.toLowerCase().startsWith(candidate.toLowerCase()))) {
        prefix = candidate;
        i++;
      } else {
        break;
      }
    }
  }

  if (prefix.length <= base.length) return null;
  return prefix + input.slice(base.length);
}
