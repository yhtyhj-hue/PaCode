/**
 * Transcript 缓冲 — ctrl+o 展开完整工具链（对齐 CC transcript 模式）
 */

export type TranscriptEntryKind = 'skill' | 'prefetch' | 'tool_use' | 'tool_result';

export interface TranscriptEntry {
  kind: TranscriptEntryKind;
  label: string;
  detail?: string;
}

export class TranscriptBuffer {
  readonly maxCollapsed = 3;
  entries: TranscriptEntry[] = [];
  expanded = false;

  add(entry: TranscriptEntry): void {
    this.entries.push(entry);
  }

  hiddenCount(): number {
    if (this.expanded) return 0;
    return Math.max(0, this.entries.length - this.maxCollapsed);
  }

  toggleExpand(): boolean {
    this.expanded = !this.expanded;
    return this.expanded;
  }

  visibleEntries(): TranscriptEntry[] {
    if (this.expanded) return this.entries;
    return this.entries.slice(-this.maxCollapsed);
  }
}

export function isCtrlOKey(str: string, key?: { ctrl?: boolean; name?: string }): boolean {
  return str === '\u000f' || !!(key?.ctrl && key.name === 'o');
}
