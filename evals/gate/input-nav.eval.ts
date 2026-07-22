/**
 * Gate: input history + slash ↑↓ selection
 */

import { describe, it, expect } from 'vitest';
import { InputHistory } from '../../src/cli/input-history.js';
import { formatSlashMenu, filterSlashCommands } from '../../src/cli/slash-menu.js';

describe('eval:gate:input-nav', () => {
  it('history up/down works', () => {
    const h = new InputHistory();
    h.push('hello');
    expect(h.up('')).toBe('hello');
    expect(h.down('hello')).toBe('');
  });

  it('slash menu can highlight a selection', () => {
    const entries = filterSlashCommands('/');
    expect(entries.length).toBeGreaterThan(3);
    const lines = formatSlashMenu(entries.slice(0, 5), 24, 80, 2);
    expect(lines[2]).toContain('❯');
  });
});
