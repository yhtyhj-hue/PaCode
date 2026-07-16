/**
 * 单键 y/n 确认 — 不复用 ReplLineEditor，避免与聊天输入框抢 raw mode
 */

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

export interface ConfirmYesNoOptions {
  title: string;
  lines?: string[];
  /** Enter 默认允许（Claude Code 风格） */
  defaultYes?: boolean;
  shouldAbort?: () => boolean;
  write?: (text: string) => void;
}

/**
 * 读单键确认。y → true；n/Ctrl+C → false；Enter → defaultYes。
 * 调用前请 pause ReplLineEditor。
 */
export function confirmYesNo(options: ConfirmYesNoOptions): Promise<boolean> {
  const write = options.write ?? ((t: string) => process.stdout.write(t));
  const defaultYes = options.defaultYes !== false;

  if (!process.stdin.isTTY) {
    if (process.env['PACODE_AUTO_APPROVE'] === '1') return Promise.resolve(true);
    return Promise.resolve(false);
  }

  write(`\n${YELLOW}?${RESET} ${BOLD}${options.title}${RESET}\n`);
  for (const line of options.lines ?? []) {
    write(`  ${DIM}·${RESET} ${line}\n`);
  }
  const hint = defaultYes
    ? `[${BOLD}y${RESET}]es / ${BOLD}n${RESET}o  ${DIM}(Enter=yes · 本会话记住)${RESET}`
    : `${BOLD}y${RESET}es / [${BOLD}n${RESET}]o  ${DIM}(Enter=no)${RESET}`;
  write(`${YELLOW}Allow?${RESET} ${hint} `);

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let settled = false;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();

    const cleanup = (): void => {
      clearInterval(poll);
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
    };

    const finish = (allowed: boolean): void => {
      if (settled) return;
      settled = true;
      cleanup();
      write(allowed ? `${GREEN}✓${RESET} Allowed\n` : `${RED}✗${RESET} Denied\n`);
      resolve(allowed);
    };

    const onData = (data: Buffer): void => {
      if (options.shouldAbort?.()) {
        finish(false);
        return;
      }
      const char = data.toString();
      if (char === '\u0003') {
        finish(false);
        return;
      }
      if (char === '\r' || char === '\n') {
        finish(defaultYes);
        return;
      }
      const answer = char.trim().toLowerCase();
      if (answer === 'y') finish(true);
      else if (answer === 'n') finish(false);
    };

    const poll = setInterval(() => {
      if (options.shouldAbort?.()) finish(false);
    }, 100);

    stdin.on('data', onData);
  });
}
