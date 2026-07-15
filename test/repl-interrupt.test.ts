/**
 * REPL Ctrl+C interrupt tests
 */

import { describe, it, expect } from 'vitest';
import {
  resolveCtrlCAction,
  isCtrlCKey,
  CTRL_C_EXIT_WINDOW_MS,
  shouldDedupeCtrlC,
} from '../src/cli/repl-interrupt.js';

describe('repl-interrupt', () => {
  it('detects ctrl+c from key or \\x03', () => {
    expect(isCtrlCKey('\u0003')).toBe(true);
    expect(isCtrlCKey('', { ctrl: true, name: 'c' })).toBe(true);
    expect(isCtrlCKey('c', { ctrl: false, name: 'c' })).toBe(false);
  });

  it('clears buffer when input is non-empty', () => {
    expect(
      resolveCtrlCAction({
        isProcessing: false,
        bufferLength: 3,
        lastCtrlCAt: 0,
        now: 1000,
      })
    ).toBe('clear-buffer');
  });

  it('shows exit hint on first empty ctrl+c', () => {
    expect(
      resolveCtrlCAction({
        isProcessing: false,
        bufferLength: 0,
        lastCtrlCAt: 0,
        now: 1000,
      })
    ).toBe('hint-exit');
  });

  it('exits on second ctrl+c within window', () => {
    const now = 5000;
    expect(
      resolveCtrlCAction({
        isProcessing: false,
        bufferLength: 0,
        lastCtrlCAt: now - 500,
        now,
        exitWindowMs: CTRL_C_EXIT_WINDOW_MS,
      })
    ).toBe('exit');
  });

  it('aborts processing on first ctrl+c during query', () => {
    expect(
      resolveCtrlCAction({
        isProcessing: true,
        bufferLength: 0,
        lastCtrlCAt: 0,
        now: 1000,
      })
    ).toBe('abort-processing');
  });

  it('exits on second ctrl+c while processing', () => {
    const now = 9000;
    expect(
      resolveCtrlCAction({
        isProcessing: true,
        bufferLength: 0,
        lastCtrlCAt: now - 300,
        now,
      })
    ).toBe('exit');
  });

  it('dedupes double ctrl+c within short window', () => {
    expect(shouldDedupeCtrlC(1000, 1050)).toBe(true);
    expect(shouldDedupeCtrlC(1000, 1101)).toBe(false);
    expect(shouldDedupeCtrlC(0, 1000)).toBe(false);
  });
});
