/**
 * confirmYesNo — single-key permission confirm
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { confirmYesNo } from '../src/cli/confirm-prompt.js';

describe('confirmYesNo', () => {
  let write: ReturnType<typeof vi.fn>;
  let stdin: EventEmitter & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    write = vi.fn();
    stdin = Object.assign(new EventEmitter(), {
      isTTY: true,
      isRaw: false,
      setRawMode: vi.fn(),
      resume: vi.fn(),
    });
    vi.stubGlobal('process', {
      ...process,
      stdin,
      env: { ...process.env },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows on y', async () => {
    const p = confirmYesNo({ title: 'Allow Bash', write });
    await Promise.resolve();
    stdin.emit('data', Buffer.from('y'));
    await expect(p).resolves.toBe(true);
    expect(write.mock.calls.some((c) => String(c[0]).includes('Allowed'))).toBe(true);
  });

  it('denies on n', async () => {
    const p = confirmYesNo({ title: 'Allow Bash', write });
    await Promise.resolve();
    stdin.emit('data', Buffer.from('n'));
    await expect(p).resolves.toBe(false);
  });

  it('Enter uses defaultYes', async () => {
    const p = confirmYesNo({ title: 'Allow', defaultYes: true, write });
    await Promise.resolve();
    stdin.emit('data', Buffer.from('\r'));
    await expect(p).resolves.toBe(true);
  });

  it('aborts when shouldAbort becomes true', async () => {
    let abort = false;
    const p = confirmYesNo({
      title: 'Allow',
      write,
      shouldAbort: () => abort,
    });
    await Promise.resolve();
    abort = true;
    await expect(p).resolves.toBe(false);
  });
});
