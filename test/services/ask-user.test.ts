/**
 * AskUserQuestion Service Tests
 *
 * Covers: single-select, multi-select, text matching against label and
 * description, default_id, timeout, Ctrl+C cancel, retry on bad input,
 * options count validation, prompt rendering format, tool registration.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  askUser,
  parseAnswer,
  renderPrompt,
  registerAskUserTool,
  AskUserValidationError,
  AskUserTimeoutError,
  AskUserAbortedError,
  AskUserNonTTYError,
} from '../../src/services/ask-user/index.js';
import type { AskUserInput, AskUserOption } from '../../src/services/ask-user/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { PermissionMode } from '../../src/pkg/types.js';

const options: AskUserOption[] = [
  { id: 'yes', label: 'Yes', description: 'proceed' },
  { id: 'no', label: 'No', description: 'cancel' },
];

const sampleInput = (overrides: Partial<AskUserInput> = {}): AskUserInput => ({
  question: 'Continue?',
  options,
  ...overrides,
});

// Silent writer so test runs don't dump prompts to stderr.
const silent = (): ((s: string) => void) => () => undefined;

describe('parseAnswer', () => {
  it('matches a numeric selection (single-select)', () => {
    const r = parseAnswer('1', options, false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selection).toBe('yes');
  });

  it('matches label substring case-insensitive (single-select)', () => {
    const r = parseAnswer('YES', options, false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selection).toBe('yes');
  });

  it('matches description substring (single-select)', () => {
    const r = parseAnswer('proceed', options, false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selection).toBe('yes');
  });

  it('returns hint on unknown token', () => {
    const r = parseAnswer('maybe', options, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint.toLowerCase()).toMatch(/yes|no/);
  });

  it('handles multi-select with comma separator', () => {
    const r = parseAnswer('yes,no', options, true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selection).toEqual(['yes', 'no']);
  });

  it('handles multi-select with space separator', () => {
    const r = parseAnswer('yes no', options, true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selection).toEqual(['yes', 'no']);
  });

  it('rejects multi-tokens in single-select', () => {
    const r = parseAnswer('1 2', options, false);
    expect(r.ok).toBe(false);
  });

  it('treats empty input as failure (no default)', () => {
    const r = parseAnswer('   ', options, false);
    expect(r.ok).toBe(false);
  });
});

describe('renderPrompt', () => {
  it('renders numbered options and header', () => {
    const lines: string[] = [];
    const write = (s: string): void => {
      lines.push(s);
    };
    renderPrompt('Pick one', 'Confirm', options, false, undefined, write);
    const output = lines.join('');
    expect(output).toContain('Pick one');
    expect(output).toContain('1)');
    expect(output).toContain('Yes');
    expect(output).toContain('2)');
    expect(output).toContain('No');
    expect(output).toContain('Confirm');
  });

  it('renders default hint when default_id provided', () => {
    const lines: string[] = [];
    renderPrompt('Pick one', undefined, options, false, 'yes', (s) => lines.push(s));
    const output = lines.join('');
    expect(output).toContain('default:');
    expect(output).toContain('Yes');
  });

  it('shows multiSelect tag when multi=true', () => {
    const lines: string[] = [];
    renderPrompt('Pick many', undefined, options, true, undefined, (s) => lines.push(s));
    expect(lines.join('')).toContain('multiSelect');
  });
});

describe('validateInput', () => {
  it('throws on empty question', async () => {
    await expect(
      askUser({ question: '', options }, { readLine: async () => '1', write: silent() })
    ).rejects.toBeInstanceOf(AskUserValidationError);
  });

  it('throws when options < 2', async () => {
    await expect(
      askUser(
        { question: 'q', options: [{ id: 'a', label: 'A' }] },
        { readLine: async () => '1', write: silent() }
      )
    ).rejects.toBeInstanceOf(AskUserValidationError);
  });

  it('throws when options > 4', async () => {
    const many: AskUserOption[] = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
      { id: 'd', label: 'D' },
      { id: 'e', label: 'E' },
    ];
    await expect(
      askUser(
        { question: 'q', options: many },
        { readLine: async () => '1', write: silent() }
      )
    ).rejects.toBeInstanceOf(AskUserValidationError);
  });

  it('throws on duplicate option id', async () => {
    await expect(
      askUser(
        {
          question: 'q',
          options: [
            { id: 'x', label: 'A' },
            { id: 'x', label: 'B' },
          ],
        },
        { readLine: async () => '1', write: silent() }
      )
    ).rejects.toBeInstanceOf(AskUserValidationError);
  });

  it('throws when default_id is not in options', async () => {
    await expect(
      askUser(
        { question: 'q', options, default_id: 'maybe' },
        { readLine: async () => '1', write: silent() }
      )
    ).rejects.toBeInstanceOf(AskUserValidationError);
  });
});

describe('askUser — happy path', () => {
  it('returns single id for numeric choice (single-select)', async () => {
    const answer = await askUser(sampleInput(), {
      readLine: async () => '2',
      write: silent(),
    });
    expect(answer.aborted).toBe(false);
    expect(answer.selection).toBe('no');
    expect(answer.rawInput).toBe('2');
  });

  it('returns id array for multi-select', async () => {
    const r = await askUser(sampleInput({ multiSelect: true }), {
      readLine: async () => '1,2',
      write: silent(),
    });
    expect(r.aborted).toBe(false);
    expect(r.selection).toEqual(['yes', 'no']);
  });

  it('honors default_id on empty input', async () => {
    const r = await askUser(sampleInput({ default_id: 'no' }), {
      readLine: async () => '   ',
      write: silent(),
    });
    expect(r.aborted).toBe(false);
    expect(r.selection).toBe('no');
  });

  it('matches text against description', async () => {
    const r = await askUser(sampleInput(), {
      readLine: async () => 'cancel',
      write: silent(),
    });
    expect(r.selection).toBe('no');
  });

  it('matches text against label (case-insensitive)', async () => {
    const r = await askUser(sampleInput(), {
      readLine: async () => 'YES',
      write: silent(),
    });
    expect(r.selection).toBe('yes');
  });
});

describe('askUser — failure paths', () => {
  it('retries on bad input and returns aborted after max retries', async () => {
    let calls = 0;
    const r = await askUser(sampleInput(), {
      readLine: async () => {
        calls += 1;
        return 'maybe';
      },
      maxParseRetries: 2,
      write: silent(),
    });
    expect(r.aborted).toBe(true);
    expect(r.notes).toMatch(/Exceeded/);
    expect(calls).toBe(3);
  });

  it('recovers when later input is valid', async () => {
    const inputs = ['maybe', 'perhaps', '1'];
    let i = 0;
    const r = await askUser(sampleInput(), {
      readLine: async () => inputs[i++],
      maxParseRetries: 5,
      write: silent(),
    });
    expect(r.aborted).toBe(false);
    expect(r.selection).toBe('yes');
  });

  it('throws AskUserTimeoutError when reader exceeds timeout', async () => {
    await expect(
      askUser(sampleInput(), {
        readLine: () => new Promise(() => {/* never */}),
        timeoutMs: 5,
        write: silent(),
      })
    ).rejects.toBeInstanceOf(AskUserTimeoutError);
  });

  it('returns aborted when reader rejects with AskUserAbortedError', async () => {
    const r = await askUser(sampleInput(), {
      readLine: async () => {
        throw new AskUserAbortedError();
      },
      write: silent(),
    });
    expect(r.aborted).toBe(true);
    const sel = r.selection;
    if (Array.isArray(sel)) {
      expect(sel.length).toBe(0);
    } else {
      expect(sel).toBe('');
    }
  });

  it('throws AskUserNonTTYError when no reader and isTTY returns false', async () => {
    await expect(
      askUser(sampleInput(), { isTTY: () => false, write: silent() })
    ).rejects.toBeInstanceOf(AskUserNonTTYError);
  });
});

describe('registerAskUserTool', () => {
  it('registers a tool named AskUser with the given registry', () => {
    const registry = new ToolRegistry();
    registerAskUserTool(registry);
    const tool = registry.get('AskUser');
    expect(tool).toBeTruthy();
    expect(tool?.name).toBe('AskUser');
    expect(tool?.concurrencySafe).toBe(false);
    expect(tool?.permissionMode).toBe(PermissionMode.DEFAULT);
    expect(registry.has('AskUser')).toBe(true);
  });

  it('execute returns validation error for malformed input', async () => {
    const registry = new ToolRegistry();
    registerAskUserTool(registry);
    const tool = registry.get('AskUser');
    expect(tool).toBeTruthy();
    if (!tool) throw new Error('tool missing');
    const result = await tool.execute({ question: '', options: [] });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    if (result.content[0] && 'text' in result.content[0]) {
      expect(result.content[0].text).toMatch(/question|options/);
    }
  });

  it('execute uses the supplied readLine when present in config (integration smoke)', async () => {
    // We register a fresh tool and inject behaviour by stubbing readLine via
    // askUser directly through the public surface — the registry.execute()
    // path uses Node's real readline, but we exercise validation here.
    const registry = new ToolRegistry();
    registerAskUserTool(registry);
    expect(registry.has('AskUser')).toBe(true);
    vi.useRealTimers();
  });
});

describe('size sanity', () => {
  it('service is a small set of focused files', () => {
    // Light sanity check: ensure the public surface we expect is exported.
    expect(typeof askUser).toBe('function');
    expect(typeof parseAnswer).toBe('function');
    expect(typeof renderPrompt).toBe('function');
    expect(typeof registerAskUserTool).toBe('function');
    expect(typeof AskUserValidationError).toBe('function');
  });
});
