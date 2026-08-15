/**
 * K7 Ink TUI — controller reducer 单元测试(无需 Ink 渲染)
 */

import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  reduceTuiState,
  dispatchActions,
  MAX_TRANSCRIPT_LINES,
  colorForLineKind,
  formatTokenCount,
  toolIcon,
  formatStats,
  formatToolLineText,
  pickToolPath,
  computeToolStats,
  Actions,
} from '../src/cli/tui/controller.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('TUI controller reducer', () => {
  it('initial state has empty lines + idle live', () => {
    const s = createInitialState(PermissionMode.DEFAULT);
    expect(s.lines).toEqual([]);
    expect(s.live.busy).toBe(false);
    expect(s.live.status).toBe('ready');
    expect(s.live.mode).toBe(PermissionMode.DEFAULT);
    expect(s.live.outputTokens).toBe(0);
  });

  it('appends user / system / error / tool lines', () => {
    let s = createInitialState(PermissionMode.DEFAULT);
    s = dispatchActions(s, [
      Actions.appendUser('hello'),
      Actions.appendSystem('started'),
      Actions.appendError('oops'),
      Actions.appendTool({ name: 'Bash', path: 'ls -la' }),
    ]);
    expect(s.lines.map((l) => l.kind)).toEqual(['user', 'system', 'error', 'tool']);
    expect(s.lines[0]?.text).toBe('❯ hello');
    expect(s.lines[3]?.text).toContain('Bash');
    expect(s.lines[3]?.who).toBe('tool');
    expect(s.lines[3]?.tool?.path).toBe('ls -la');
  });

  it('merges consecutive assistant deltas into single line', () => {
    let s = createInitialState(PermissionMode.DEFAULT);
    s = dispatchActions(s, [
      Actions.appendAssistantDelta('Hello'),
      Actions.appendAssistantDelta(' world'),
    ]);
    expect(s.lines).toEqual([{ kind: 'assistant', who: 'assistant', text: 'Hello world' }]);
  });

  it('truncates transcript when exceeding MAX_TRANSCRIPT_LINES', () => {
    let s = createInitialState(PermissionMode.DEFAULT);
    const many = Array.from({ length: MAX_TRANSCRIPT_LINES + 5 }, () =>
      Actions.appendSystem('x')
    );
    s = dispatchActions(s, many);
    expect(s.lines.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_LINES + 1);
    expect(s.lines[0]?.text).toMatch(/earlier lines hidden/);
  });

  it('setBusy / setStatus / setMode mutate live state only', () => {
    let s = createInitialState(PermissionMode.DEFAULT);
    s = dispatchActions(s, [
      Actions.setBusy(true),
      Actions.setStatus('querying'),
      Actions.setMode(PermissionMode.ACCEPT_EDITS),
      Actions.setProgressPhase('Reading…'),
      Actions.setLiveTasks([{ label: 'task-1', status: 'pending' }]),
      Actions.setToolRunning({ name: 'Bash', timeoutMs: 60_000 }),
    ]);
    expect(s.live.busy).toBe(true);
    expect(s.live.status).toBe('querying');
    expect(s.live.mode).toBe(PermissionMode.ACCEPT_EDITS);
    expect(s.live.progressPhase).toBe('Reading…');
    expect(s.live.liveTaskLines).toEqual([{ label: 'task-1', status: 'pending' }]);
    expect(s.live.toolRunning?.name).toBe('Bash');
  });

  it('addTokens accumulates input and output', () => {
    let s = createInitialState(PermissionMode.DEFAULT);
    s = dispatchActions(s, [
      Actions.addTokens(100, 50),
      Actions.addTokens(200, 75),
    ]);
    expect(s.live.inputTokens).toBe(300);
    expect(s.live.outputTokens).toBe(125);
  });

  it('clear wipes transcript but preserves live', () => {
    let s = createInitialState(PermissionMode.DEFAULT);
    s = dispatchActions(s, [
      Actions.appendUser('a'),
      Actions.setBusy(true),
      Actions.clear(),
    ]);
    expect(s.lines).toEqual([]);
    expect(s.live.busy).toBe(true);
  });

  it('colorForLineKind maps kinds to names', () => {
    expect(colorForLineKind('user')).toBe('cyan');
    expect(colorForLineKind('tool')).toBe('magenta');
    expect(colorForLineKind('system')).toBe('gray');
    expect(colorForLineKind('error')).toBe('red');
    expect(colorForLineKind('assistant')).toBeUndefined();
  });

  it('formatTokenCount humanizes values', () => {
    expect(formatTokenCount(500)).toBe('500');
    expect(formatTokenCount(2500)).toBe('2.5k');
    expect(formatTokenCount(12_000)).toBe('12.0k');
    expect(formatTokenCount(2_500_000)).toBe('2.5M');
  });

  it('reduceTuiState is pure: same input → same output', () => {
    const s = createInitialState(PermissionMode.DEFAULT);
    const next1 = reduceTuiState(s, Actions.appendSystem('a'));
    const next2 = reduceTuiState(s, Actions.appendSystem('a'));
    expect(next1).toEqual(next2);
    expect(next1).not.toBe(s);
  });
});

describe('tool icon / stats / line text', () => {
  it('toolIcon maps known tool names', () => {
    expect(toolIcon('Read')).toBe('📄');
    expect(toolIcon('Edit')).toBe('✏️');
    expect(toolIcon('Write')).toBe('📝');
    expect(toolIcon('Bash')).toBe('⌨️');
    expect(toolIcon('Grep')).toBe('🔍');
    expect(toolIcon('Glob')).toBe('📁');
    expect(toolIcon('Task')).toBe('📋');
    expect(toolIcon('UnknownTool')).toBe('▸');
  });

  it('formatStats renders each kind', () => {
    expect(formatStats({ kind: 'lines', count: 120 })).toBe('120 lines');
    expect(formatStats({ kind: 'matches', count: 8 })).toBe('8 matches');
    expect(formatStats({ kind: 'paths', count: 42 })).toBe('42 paths');
    expect(formatStats({ kind: 'diff', added: 6, removed: 2 })).toBe('+6 -2');
    expect(formatStats({ kind: 'elapsed', ms: 1200 })).toBe('1.2s');
    expect(formatStats({ kind: 'elapsed', ms: 250 })).toBe('250ms');
    expect(formatStats({ kind: 'note', text: 'applied' })).toBe('applied');
    expect(formatStats(undefined)).toBe('');
  });

  it('formatToolLineText composes icon + name + path + stats', () => {
    expect(
      formatToolLineText({
        name: 'Read',
        path: 'src/auth/session.ts',
        stats: { kind: 'lines', count: 120 },
      })
    ).toBe('📄 Read src/auth/session.ts  120 lines');

    expect(formatToolLineText({ name: 'Bash', path: 'ls' })).toBe('⌨️ Bash ls');
    expect(formatToolLineText({ name: 'Edit' })).toBe('✏️ Edit');
  });
});

describe('pickToolPath', () => {
  it('picks path for Read/Write/Edit/Glob', () => {
    expect(pickToolPath({ name: 'Read', input: { path: 'src/auth/session.ts' } })).toBe(
      'src/auth/session.ts'
    );
    expect(pickToolPath({ name: 'Edit', input: { path: '/abs/path' } })).toBe('/abs/path');
    expect(pickToolPath({ name: 'Glob', input: { pattern: 'src/**/*.ts' } })).toBe(
      'src/**/*.ts'
    );
  });

  it('picks pattern + path for Grep', () => {
    expect(
      pickToolPath({
        name: 'Grep',
        input: { pattern: 'isExpired', path: 'src/auth' },
      })
    ).toBe('"isExpired" in src/auth');
    expect(pickToolPath({ name: 'Grep', input: { pattern: 'foo' } })).toBe('"foo"');
  });

  it('picks command for Bash (truncated to 60 chars)', () => {
    expect(pickToolPath({ name: 'Bash', input: { command: 'ls -la' } })).toBe('ls -la');
    const long = 'echo ' + 'x'.repeat(80);
    const out = pickToolPath({ name: 'Bash', input: { command: long } });
    expect(out?.length).toBeLessThanOrEqual(60);
  });

  it('returns undefined for unknown / no-arg tools', () => {
    expect(pickToolPath({ name: 'TodoWrite', input: {} })).toBeUndefined();
  });
});

describe('computeToolStats', () => {
  it('counts lines for Read', () => {
    expect(
      computeToolStats({ name: 'Read', input: { path: 'x' } }, 'a\nb\nc')
    ).toEqual({ kind: 'lines', count: 3 });
  });

  it('counts paths for Glob', () => {
    expect(
      computeToolStats({ name: 'Glob', input: { pattern: '*' } }, 'a\nb\nc')
    ).toEqual({ kind: 'paths', count: 3 });
  });

  it('counts matches for Grep', () => {
    expect(
      computeToolStats({ name: 'Grep', input: { pattern: 'x' } }, 'a\nb\nc')
    ).toEqual({ kind: 'matches', count: 3 });
  });

  it('parses +N -M for Edit', () => {
    expect(
      computeToolStats({ name: 'Edit', input: { path: 'x' } }, '+6 -2 applied')
    ).toEqual({ kind: 'diff', added: 6, removed: 2 });
  });

  it('returns elapsed for Bash', () => {
    expect(
      computeToolStats({ name: 'Bash', input: { command: 'ls' } }, '', 1500)
    ).toEqual({ kind: 'elapsed', ms: 1500 });
  });

  it('returns undefined for unknown tools', () => {
    expect(
      computeToolStats({ name: 'TodoWrite', input: {} }, 'anything')
    ).toBeUndefined();
  });
});