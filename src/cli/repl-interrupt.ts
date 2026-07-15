/**
 * REPL Ctrl+C 行为 — 第一次取消/清输入，2 秒内再按退出
 */

export const CTRL_C_EXIT_WINDOW_MS = 2000;

/** raw TTY 下 keypress 与 SIGINT 会双触发，短窗口内去重 */
export const CTRL_C_DEDUPE_MS = 100;

export function shouldDedupeCtrlC(lastHandledAt: number, now: number): boolean {
  return lastHandledAt > 0 && now - lastHandledAt < CTRL_C_DEDUPE_MS;
}

export type CtrlCAction = 'clear-buffer' | 'abort-processing' | 'hint-exit' | 'exit';

export function isCtrlCKey(str: string, key?: { ctrl?: boolean; name?: string }): boolean {
  return str === '\u0003' || !!(key?.ctrl && key.name === 'c');
}

export function resolveCtrlCAction(input: {
  isProcessing: boolean;
  bufferLength: number;
  lastCtrlCAt: number;
  now: number;
  exitWindowMs?: number;
}): CtrlCAction {
  const exitWindowMs = input.exitWindowMs ?? CTRL_C_EXIT_WINDOW_MS;
  const withinExitWindow = input.now - input.lastCtrlCAt < exitWindowMs;

  if (input.isProcessing) {
    return withinExitWindow && input.lastCtrlCAt > 0 ? 'exit' : 'abort-processing';
  }

  if (input.bufferLength > 0) {
    return 'clear-buffer';
  }

  if (withinExitWindow && input.lastCtrlCAt > 0) {
    return 'exit';
  }

  return 'hint-exit';
}
