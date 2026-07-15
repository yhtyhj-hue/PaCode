/**
 * Terminal rendering for AskUserQuestion.
 *
 * The renderer is intentionally side-effectful: it writes prompt text to a
 * caller-provided `write` function (defaults to process.stderr so that it does
 * not collide with stdout, which is the channel used by the REPL line editor).
 */

import type { AskUserOption } from './types.js';

const DEFAULT_WRITER: (text: string) => void = (text) => {
  process.stderr.write(text);
};

function formatHeader(header: string | undefined, multi: boolean): string {
  const tag = multi ? 'multiSelect' : 'select';
  return header ? `${header} [${tag}]` : `[${tag}]`;
}

export function renderPrompt(
  question: string,
  header: string | undefined,
  options: AskUserOption[],
  multi: boolean,
  defaultId: string | undefined,
  writer: (text: string) => void = DEFAULT_WRITER
): void {
  writer('\n');
  writer(formatHeader(header, multi));
  writer('\n');
  writer('? ');
  writer(question);
  writer('\n');

  options.forEach((opt, idx) => {
    const number = `${idx + 1})`.padEnd(4);
    writer(`   ${number}${opt.label}`);
    if (opt.description) {
      writer(` — ${opt.description}`);
    }
    writer('\n');
  });

  if (defaultId) {
    const def = options.find((o) => o.id === defaultId);
    if (def) {
      writer(`   (default: ${def.label})\n`);
    }
  }

  writer(multi ? 'Pick numbers or labels (space/comma separated): ' : 'Pick a number or label: ');
}

export function renderHint(hint: string, writer: (text: string) => void = DEFAULT_WRITER): void {
  writer(`! ${hint}\n`);
}
