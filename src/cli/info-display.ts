/**
 * /context /memory /providers /model 纯文本 — REPL / TUI 共用
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { CCSwitchClient, type Provider } from '../pkg/ccswitch/index.js';

export function formatContextLines(input: {
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
}): string[] {
  return [
    'Context Usage',
    `  Messages:   ${input.messageCount}`,
    `  Tokens:     ${input.inputTokens + input.outputTokens} (in=${input.inputTokens} out=${input.outputTokens})`,
  ];
}

export function formatMemoryLines(cwd = process.cwd()): string[] {
  return [
    'Memory Locations',
    `  User memory:    ${join(homedir(), '.paude', 'memory')}/`,
    `  Project memory: ${join(cwd, '.paude', 'projects')}/{hash}/`,
    `  Session memory: ${join(homedir(), '.paude', 'sessions')}/`,
  ];
}

export function formatModelLines(model: string): string[] {
  return [
    `Current model: ${model}`,
    'Available models depend on your provider',
    'Usage: /model <name>',
  ];
}

export function formatProvidersLines(
  providers?: Provider[],
  activeName?: string
): string[] {
  const cc = providers ? null : new CCSwitchClient();
  const list = providers ?? cc!.list();
  const active = activeName ?? cc?.getActive()?.name;
  if (list.length === 0) {
    return ['API Providers', '  No providers configured'];
  }
  const lines = ['API Providers'];
  for (const p of list) {
    const marker = active === p.name ? '●' : '○';
    lines.push(`  ${marker} ${p.name}${p.model ? ` (${p.model})` : ''}`);
  }
  return lines;
}
