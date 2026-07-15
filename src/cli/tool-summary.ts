/**
 * 工具调用紧凑摘要 — CC 风格 "Read 3 files (ctrl+o to expand)"
 */

import { ToolCall } from '../pkg/types.js';

function plural(count: number, singular: string, pluralForm?: string): string {
  if (count === 1) return singular;
  return pluralForm ?? `${singular}s`;
}

/** 按工具类型聚合，输出 CC 风格单行摘要 */
export function formatCompactToolSummary(tools: ToolCall[]): string {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  }

  const parts: string[] = [];
  const readN = counts.get('Read') ?? 0;
  const bashN = counts.get('Bash') ?? 0;
  const globN = counts.get('Glob') ?? 0;
  const grepN = counts.get('Grep') ?? 0;
  const writeN = (counts.get('Write') ?? 0) + (counts.get('Edit') ?? 0);

  if (readN > 0) parts.push(`Read ${readN} ${plural(readN, 'file')}`);
  if (bashN > 0) parts.push(`${bashN} ${plural(bashN, 'command', 'commands')}`);
  if (globN > 0) parts.push(`Glob ${globN} ${plural(globN, 'search', 'searches')}`);
  if (grepN > 0) parts.push(`Grep ${grepN} ${plural(grepN, 'search', 'searches')}`);
  if (writeN > 0) parts.push(`${writeN} ${plural(writeN, 'edit', 'edits')}`);

  for (const [name, n] of counts) {
    if (['Read', 'Bash', 'Glob', 'Grep', 'Write', 'Edit'].includes(name)) continue;
    parts.push(`${name} ×${n}`);
  }

  if (parts.length === 0 && tools.length > 0) {
    return `${tools.length} tool ${tools.length === 1 ? 'use' : 'uses'}`;
  }

  return parts.join(' · ');
}
