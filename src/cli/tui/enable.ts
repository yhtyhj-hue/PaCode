/**
 * TUI / legacy scrollback REPL 选择门控
 *
 * 默认走 Ink TUI(alt-screen,输入框固定底部),仅当 TTY 缺失或显式 opt-out 时才退回老 REPL。
 */

const LEGACY_ENV_KEY = 'PACODE_LEGACY_REPL';

export interface EnableOptions {
  /** --legacy-repl / --tui 之类的 CLI flag */
  legacyFlag?: boolean;
  tuiFlag?: boolean;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
}

/** 是否走老 scrollback REPL(默认 false) */
export function shouldEnableLegacy(options: EnableOptions): boolean {
  const env = options.env ?? process.env;
  if (options.legacyFlag === true) return true;
  if (env[LEGACY_ENV_KEY] === '1') return true;
  return false;
}

/** 是否走 Ink TUI(TTY 满足且未 opt-out) */
export function shouldEnableTui(options: EnableOptions): boolean {
  const env = options.env ?? process.env;
  const tty = options.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!tty) return false;
  if (shouldEnableLegacy(options)) return false;
  // 兼容老 env 开关:PACODE_TUI=1 显式开启(在 opt-out 不存在时仍生效)
  if (options.tuiFlag === true || env['PACODE_TUI'] === '1') return true;
  return true;
}
