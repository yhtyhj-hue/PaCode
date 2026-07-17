/**
 * K7: whether to launch Ink TUI instead of readline REPL
 */

export function shouldEnableTui(options: {
  tuiFlag?: boolean;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
}): boolean {
  const env = options.env ?? process.env;
  const flag = options.tuiFlag === true || env['PACODE_TUI'] === '1';
  if (!flag) return false;
  const tty = options.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  return tty;
}
