/**
 * CLI argument parsing — shared by index and tests
 */

import { parseArgs } from 'node:util';

export const CLI_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  mode: { type: 'string', short: 'm', default: 'default' },
  'api-key': { type: 'string' },
  'base-url': { type: 'string' },
  model: { type: 'string' },
  name: { type: 'string' },
  resume: { type: 'boolean', default: false },
  'session-id': { type: 'string' },
  tui: { type: 'boolean', default: false },
  /** G4：附加图片路径（可重复），如 --image shot.png */
  image: { type: 'string', multiple: true },
} as const;

export function parseCliArgs(argv: string[] = process.argv.slice(2)) {
  return parseArgs({
    options: CLI_OPTIONS,
    allowPositionals: true,
    args: argv,
  });
}

export type CliRoute =
  | 'help'
  | 'version'
  | 'cc-switch'
  | 'mcp'
  | 'init'
  | 'resume'
  | 'worktree'
  | 'agent';

/** 根据 positionals / flags 决定 CLI 路由，便于单测 */
export function resolveCliRoute(
  positionals: string[],
  values: { help?: boolean; version?: boolean; resume?: boolean }
): CliRoute {
  if (values.help) return 'help';
  if (values.version) return 'version';
  if (positionals[0] === 'cc-switch' || positionals[0] === 'ccs') return 'cc-switch';
  if (positionals[0] === 'mcp') return 'mcp';
  if (positionals[0] === 'init') return 'init';
  if (positionals[0] === 'resume') return 'resume';
  if (positionals[0] === 'worktree' || positionals[0] === 'wt') return 'worktree';
  return 'agent';
}
