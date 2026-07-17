/**
 * Slash command menu tests
 */

import { describe, it, expect } from 'vitest';
import {
  filterSlashCommands,
  formatSlashMenu,
  completeSlashCommand,
  BUILTIN_SLASH_COMMANDS,
} from '../src/cli/slash-menu.js';

describe('slash-menu', () => {
  it('shows all commands when input is bare slash', () => {
    const all = filterSlashCommands('/');
    expect(all.length).toBe(BUILTIN_SLASH_COMMANDS.length);
    expect(all.some((e) => e.command === '/help')).toBe(true);
  });

  it('filters by prefix', () => {
    const matches = filterSlashCommands('/cl');
    expect(matches.map((e) => e.command)).toEqual(['/clear']);
  });

  it('formats two-column menu lines', () => {
    const lines = formatSlashMenu([{ command: '/help', description: 'Show help' }], 24, 60);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('/help');
    expect(lines[0]).toContain('Show help');
  });

  it('completes unique match on tab', () => {
    expect(completeSlashCommand('/hel')).toBe('/help');
    expect(completeSlashCommand('/cl')).toBe('/clear');
  });

  it('merges custom commands', () => {
    const custom = [{ command: '/review', description: 'Review code' }];
    expect(filterSlashCommands('/', custom).some((e) => e.command === '/review')).toBe(true);
  });

  it('advertises /effort /vim /new', () => {
    const names = BUILTIN_SLASH_COMMANDS.map((e) => e.command);
    expect(names).toContain('/effort');
    expect(names).toContain('/vim');
    expect(names).toContain('/new');
  });
});
