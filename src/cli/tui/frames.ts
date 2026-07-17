/**
 * K7: pure transcript helpers (testable without Ink render)
 */

export type TuiLineKind = 'user' | 'assistant' | 'tool' | 'system' | 'error';

export interface TuiLine {
  kind: TuiLineKind;
  text: string;
}

export function formatToolLine(name: string, detail?: string): string {
  const d = detail?.trim();
  return d ? `▸ ${name} ${d}` : `▸ ${name}`;
}

export function appendDelta(lines: TuiLine[], delta: string): TuiLine[] {
  if (!delta) return lines;
  const last = lines[lines.length - 1];
  if (last?.kind === 'assistant') {
    return [...lines.slice(0, -1), { kind: 'assistant', text: last.text + delta }];
  }
  return [...lines, { kind: 'assistant', text: delta }];
}

export function truncateLines(lines: TuiLine[], max = 80): TuiLine[] {
  if (lines.length <= max) return lines;
  return [
    { kind: 'system', text: `… ${lines.length - max} earlier lines hidden` },
    ...lines.slice(-max),
  ];
}
