/**
 * Input history + slash menu selection
 */

import { describe, it, expect } from 'vitest';
import { InputHistory } from '../src/cli/input-history.js';
import { formatSlashMenu } from '../src/cli/slash-menu.js';

describe('InputHistory', () => {
  it('up recalls older entries; down restores draft', () => {
    const h = new InputHistory();
    h.push('first');
    h.push('second');
    expect(h.up('draft')).toBe('second');
    expect(h.isBrowsing()).toBe(true);
    expect(h.up('second')).toBe('first');
    expect(h.down('first')).toBe('second');
    expect(h.down('second')).toBe('draft');
    expect(h.isBrowsing()).toBe(false);
  });

  it('skips duplicate consecutive push', () => {
    const h = new InputHistory();
    h.push('a');
    h.push('a');
    expect(h.size()).toBe(1);
  });
});

describe('formatSlashMenu selection', () => {
  it('highlights selected row', () => {
    const lines = formatSlashMenu(
      [
        { command: '/help', description: 'Show help' },
        { command: '/clear', description: 'Clear' },
      ],
      24,
      60,
      1
    );
    expect(lines[1]).toContain('❯');
    expect(lines[1]).toContain('/clear');
    expect(lines[0]).not.toContain('❯');
  });
});
