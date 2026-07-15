/**
 * AskUserQuestion core logic.
 *
 * Wires together rendering, parsing, and the readline-shaped reader.
 * Designed for dependency injection so tests can swap the reader and writer.
 */

import type { AskUserAnswer, AskUserConfig, AskUserInput } from './types.js';
import { parseAnswer } from './parse.js';
import { renderHint, renderPrompt } from './render.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TTY_CHECK = (): boolean => Boolean(process.stdin.isTTY);

export class AskUserValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AskUserValidationError';
  }
}

export class AskUserAbortedError extends Error {
  constructor() {
    super('AskUser aborted by user');
    this.name = 'AskUserAbortedError';
  }
}

export class AskUserTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AskUser timed out after ${timeoutMs} ms`);
    this.name = 'AskUserTimeoutError';
  }
}

export class AskUserNonTTYError extends Error {
  constructor() {
    super('AskUser requires an interactive TTY; pass readLine in config to override');
    this.name = 'AskUserNonTTYError';
  }
}

export function validateInput(input: AskUserInput): void {
  if (!input.question || !input.question.trim()) {
    throw new AskUserValidationError('question must be non-empty');
  }
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 4) {
    throw new AskUserValidationError('options must contain 2-4 entries');
  }
  const seenIds = new Set<string>();
  for (const opt of input.options) {
    if (!opt.id || !opt.id.trim()) {
      throw new AskUserValidationError('each option must have a non-empty id');
    }
    if (!opt.label || !opt.label.trim()) {
      throw new AskUserValidationError(`option ${opt.id} must have a non-empty label`);
    }
    if (seenIds.has(opt.id)) {
      throw new AskUserValidationError(`duplicate option id: ${opt.id}`);
    }
    seenIds.add(opt.id);
  }
  if (input.default_id && !seenIds.has(input.default_id)) {
    throw new AskUserValidationError(
      `default_id "${input.default_id}" does not match any option id`
    );
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function readWithReader(
  readLine: (prompt: string) => Promise<string>,
  multi: boolean,
  defaultId: string | undefined,
  write: (text: string) => void,
  retryHint?: string
): Promise<string> {
  const promptText = retryHint ? `(retry) > ` : multi ? 'multi-select > ' : 'select > ';
  if (retryHint) write(`(retry) ${retryHint}\n`);
  if (defaultId !== undefined && !retryHint) {
    write(`(press enter for default "${defaultId}")\n`);
  }
  return readLine(promptText);
}

export async function askUser(
  input: AskUserInput,
  config: AskUserConfig
): Promise<AskUserAnswer> {
  validateInput(input);

  const {
    readLine,
    isTTY = DEFAULT_TTY_CHECK,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxParseRetries = DEFAULT_MAX_RETRIES,
    write = (text) => process.stderr.write(text),
  } = config;

  // Non-interactive safety: we require a reader that the caller explicitly
  // supplied OR a real TTY. Otherwise throw — call sites can catch & fallback
  // to { aborted: true } if they prefer.
  if (!readLine && !isTTY()) {
    throw new AskUserNonTTYError();
  }

  const multi = Boolean(input.multiSelect);

  let attempt = 0;
  let lastHint: string | undefined;

  // Outer loop: retry only on parse failure (not on abort/timeout).
  while (true) {
    renderPrompt(input.question, input.header, input.options, multi, input.default_id, write);
    if (lastHint) renderHint(lastHint, write);

    let raw: string;
    try {
      raw = await withTimeout(
        readWithReader(readLine, multi, input.default_id, write, lastHint),
        timeoutMs,
        () => new AskUserTimeoutError(timeoutMs)
      );
    } catch (e) {
      if (e instanceof AskUserAbortedError) {
        return { selection: multi ? [] : '', rawInput: '', aborted: true };
      }
      throw e;
    }

    // Empty + default configured → use default, no retry.
    if (!raw.trim() && input.default_id !== undefined) {
      return {
        selection: multi ? [input.default_id as string] : (input.default_id as string),
        rawInput: raw,
        aborted: false,
      };
    }

    const result = parseAnswer(raw, input.options, multi);
    if (result.ok) {
      return { selection: result.selection, rawInput: raw, aborted: false };
    }

    attempt += 1;
    lastHint = result.hint;
    if (attempt > maxParseRetries) {
      return {
        selection: multi ? [] : '',
        rawInput: raw,
        aborted: true,
        notes: `Exceeded ${maxParseRetries} retries: ${result.hint}`,
      };
    }
  }
}
