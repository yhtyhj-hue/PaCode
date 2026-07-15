/**
 * Context compiler tests
 */

import { describe, it, expect } from 'vitest';
import { repairToolResultPairing, compileMessagesForApi } from '../src/services/context-compiler/index.js';
import { Message } from '../src/pkg/types.js';

describe('repairToolResultPairing', () => {
  it('strips orphan tool_result without preceding assistant tool_use', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'bootstrap_glob_1',
            toolResult: { content: [{ type: 'text' as const, text: 'x' }] },
          },
        ],
        timestamp: 1,
      },
    ];

    const { messages: repaired, issues } = repairToolResultPairing(messages);
    expect(repaired).toHaveLength(0);
    expect(issues.some((i) => i.includes('orphan'))).toBe(true);
  });

  it('synthesizes missing tool_result after assistant tool_use', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            toolUse: { id: 'tu_1', name: 'Read', input: { path: 'a.ts' } },
          },
        ],
        timestamp: 1,
      },
      { role: 'user', content: 'continue', timestamp: 2 },
    ];

    const { messages: repaired, issues } = repairToolResultPairing(messages);
    expect(issues.some((i) => i.includes('synthesized'))).toBe(true);
    expect(repaired).toHaveLength(3);
    expect(repaired[1]?.role).toBe('user');
    expect(Array.isArray(repaired[1]?.content)).toBe(true);
  });

  it('pairs existing tool_result blocks', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            toolUse: { id: 'tu_1', name: 'Read', input: {} },
          },
        ],
        timestamp: 1,
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'tu_1',
            toolResult: { content: [{ type: 'text' as const, text: 'ok' }] },
          },
        ],
        timestamp: 2,
      },
    ];

    const { messages: repaired, issues } = repairToolResultPairing(messages);
    expect(issues).toHaveLength(0);
    expect(repaired).toHaveLength(2);
  });
});

describe('compileMessagesForApi', () => {
  it('throws in strict mode when pairing is invalid', () => {
    expect(() =>
      compileMessagesForApi(
        [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                toolUseId: 'orphan',
                toolResult: { content: [{ type: 'text' as const, text: 'x' }] },
              },
            ],
            timestamp: 1,
          },
        ],
        { strict: true }
      )
    ).toThrow(/Tool pairing invalid/);
  });
});
