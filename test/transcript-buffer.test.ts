/**
 * Transcript buffer tests
 */

import { describe, it, expect } from 'vitest';
import { TranscriptBuffer, isCtrlOKey } from '../src/cli/transcript-buffer.js';

describe('TranscriptBuffer', () => {
  it('tracks hidden count when collapsed', () => {
    const buf = new TranscriptBuffer();
    for (let i = 0; i < 5; i++) {
      buf.add({ kind: 'prefetch', label: `tool-${i}` });
    }
    expect(buf.hiddenCount()).toBe(2);
    expect(buf.visibleEntries()).toHaveLength(3);
  });

  it('shows all entries when expanded', () => {
    const buf = new TranscriptBuffer();
    buf.add({ kind: 'skill', label: 'review' });
    buf.add({ kind: 'prefetch', label: 'Read' });
    buf.toggleExpand();
    expect(buf.visibleEntries()).toHaveLength(2);
    expect(buf.hiddenCount()).toBe(0);
  });
});

describe('isCtrlOKey', () => {
  it('detects ctrl+o', () => {
    expect(isCtrlOKey('', { ctrl: true, name: 'o' })).toBe(true);
    expect(isCtrlOKey('\u000f', {})).toBe(true);
    expect(isCtrlOKey('o', { ctrl: false })).toBe(false);
  });
});
