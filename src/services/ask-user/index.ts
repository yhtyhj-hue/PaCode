/**
 * AskUserQuestion Service
 *
 * Exposes an interactive REPL question tool compatible with the project's
 * ToolDefinition contract. The tool is registered lazily through
 * `registerAskUserTool`, which the tool bootstrap calls when wired in.
 */

import { PermissionMode, type ToolContext, type ToolDefinition } from '../../pkg/types.js';
import { ToolRegistry } from '../../tools/registry.js';
import {
  askUser,
  AskUserAbortedError,
  AskUserNonTTYError,
  AskUserTimeoutError,
  AskUserValidationError,
} from './ask.js';
import type { AskUserAnswer, AskUserInput } from './types.js';

export type { AskUserAnswer, AskUserInput, AskUserOption, AskUserConfig } from './types.js';
export { parseAnswer } from './parse.js';
export { renderPrompt } from './render.js';
export {
  askUser,
  AskUserAbortedError,
  AskUserNonTTYError,
  AskUserTimeoutError,
  AskUserValidationError,
} from './ask.js';

const TOOL_NAME = 'AskUser';

const TRUTHY = new Set(['1', 'true', 'yes']);

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return TRUTHY.has(value.trim().toLowerCase());
  return false;
}

function coerceInput(raw: Record<string, unknown>): AskUserInput {
  const question = typeof raw['question'] === 'string' ? raw['question'] : '';
  const header = typeof raw['header'] === 'string' ? raw['header'] : undefined;
  const rawOptions = raw['options'];

  if (!Array.isArray(rawOptions)) {
    throw new AskUserValidationError('options must be an array');
  }

  const options = rawOptions.map((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      throw new AskUserValidationError(`option ${idx} must be an object`);
    }
    const obj = entry as Record<string, unknown>;
    const id = typeof obj['id'] === 'string' ? obj['id'] : '';
    const label = typeof obj['label'] === 'string' ? obj['label'] : '';
    const description =
      typeof obj['description'] === 'string' ? (obj['description'] as string) : undefined;
    if (!id) throw new AskUserValidationError(`option ${idx} missing id`);
    if (!label) throw new AskUserValidationError(`option ${idx} missing label`);
    return { id, label, description };
  });

  const multiSelect = coerceBoolean(raw['multiSelect']);
  const defaultId = typeof raw['default_id'] === 'string' ? raw['default_id'] : undefined;

  return {
    question,
    header,
    options,
    multiSelect,
    default_id: defaultId,
  };
}

function formatSelection(answer: AskUserAnswer): string {
  if (answer.aborted) return 'aborted';
  if (Array.isArray(answer.selection)) {
    return `[${answer.selection.join(', ')}]`;
  }
  return answer.selection;
}

export function registerAskUserTool(registry: ToolRegistry): void {
  const definition: ToolDefinition = {
    name: TOOL_NAME,
    description:
      'Ask the user an interactive multiple-choice question via the REPL. ' +
      'Returns the selected option id (string) for single-select, or a string[] ' +
      'of selected ids for multi-select. Aborts on Ctrl+C or timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question shown to the user.' },
        header: { type: 'string', description: 'Short label ≤12 chars shown above the prompt.' },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['id', 'label'],
          },
        },
        multiSelect: { type: 'boolean', default: false },
        default_id: { type: 'string' },
      },
      required: ['question', 'options'],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.ACCEPT_EDITS,
    async execute(input: unknown, _ctx: ToolContext) {
      const parsed = coerceInput((input ?? {}) as Record<string, unknown>);

      // Default reader wraps Node's readline against stderr so the prompt does
      // not interfere with stdout (which the REPL line editor uses).
      const readLine = (prompt: string): Promise<string> =>
        new Promise<string>((resolve, reject) => {
          // Lazy import keeps this file free of node:readline at module-load
          // time so it remains usable in non-Node test shims.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { createInterface } = require('node:readline') as typeof import('node:readline');
          const rl = createInterface({ input: process.stdin, output: process.stderr });
          let settled = false;
          const finish = (value: string): void => {
            if (settled) return;
            settled = true;
            rl.close();
            resolve(value);
          };
          rl.on('SIGINT', () => {
            finish('');
            reject(new AskUserAbortedError());
          });
          rl.question(prompt, (answer) => finish(answer));
        });

      try {
        const answer = await askUser(parsed, { readLine });
        return {
          content: [
            {
              type: 'text',
              text: `selection=${formatSelection(answer)} raw=${JSON.stringify(answer.rawInput)}`,
            },
          ],
        };
      } catch (e) {
        if (e instanceof AskUserAbortedError) {
          return { content: [{ type: 'text', text: 'aborted' }], isError: false };
        }
        if (e instanceof AskUserNonTTYError) {
          return { content: [{ type: 'text', text: e.message }], isError: true };
        }
        if (e instanceof AskUserTimeoutError) {
          return { content: [{ type: 'text', text: e.message }], isError: true };
        }
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  };

  registry.register(definition);
}
