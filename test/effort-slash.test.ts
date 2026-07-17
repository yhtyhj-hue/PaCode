/**
 * Gate: /effort maxTokens mapping + slash menu entries
 */
import { describe, it, expect } from 'vitest';
import {
  EFFORT_MAX_TOKENS,
  effortMaxTokens,
  formatEffortStatus,
  parseEffortLevel,
} from '../src/cli/effort.js';
import { BUILTIN_SLASH_COMMANDS, filterSlashCommands } from '../src/cli/slash-menu.js';
import { TUI_SLASH_HELP } from '../src/cli/tui/slash.js';

describe('effort + slash breadth', () => {
  it('maps low/medium/high to maxTokens', () => {
    expect(parseEffortLevel('LOW')).toBe('low');
    expect(parseEffortLevel('x')).toBeNull();
    expect(effortMaxTokens('low')).toBe(EFFORT_MAX_TOKENS.low);
    expect(effortMaxTokens('high')).toBe(16384);
    expect(formatEffortStatus('medium')).toContain('maxTokens=8192');
  });

  it('slash menu includes /effort /vim /new', () => {
    const names = BUILTIN_SLASH_COMMANDS.map((c) => c.command);
    expect(names).toContain('/effort');
    expect(names).toContain('/vim');
    expect(names).toContain('/new');
    expect(filterSlashCommands('/eff').some((e) => e.command === '/effort')).toBe(true);
  });

  it('TUI help lists /new /effort /vim', () => {
    expect(TUI_SLASH_HELP).toContain('/new');
    expect(TUI_SLASH_HELP).toContain('/effort');
    expect(TUI_SLASH_HELP).toContain('/vim');
  });
});
