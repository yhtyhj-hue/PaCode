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
      Actions.appendTool('Bash', 'ls -la'),
    ]);
    expect(s.lines.map((l) => l.kind)).toEqual(['user', 'system', 'error', 'tool']);
    expect(s.lines[0]?.text).toBe('❯ hello');
    expect(s.lines[3]?.text).toContain('Bash');
  });

  it('merges consecutive assistant deltas into single line', () => {
    let s = createInitialState(PermissionMode.DEFAULT);
    s = dispatchActions(s, [
      Actions.appendAssistantDelta('Hello'),
      Actions.appendAssistantDelta(' world'),
    ]);
    expect(s.lines).toEqual([{ kind: 'assistant', text: 'Hello world' }]);
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
      Actions.setLiveTasks(['task-1', 'task-2']),
      Actions.setToolRunning({ name: 'Bash', timeoutMs: 60_000 }),
    ]);
    expect(s.live.busy).toBe(true);
    expect(s.live.status).toBe('querying');
    expect(s.live.mode).toBe(PermissionMode.ACCEPT_EDITS);
    expect(s.live.progressPhase).toBe('Reading…');
    expect(s.live.liveTaskLines).toEqual(['task-1', 'task-2']);
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