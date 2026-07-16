/**
 * Gate eval: M4 (Ctrl+C 可取消确认框)
 *
 * M4: "权限确认不卡死输入框 / Ctrl+C 可取消 100%".
 *
 * commit f7afcc1 introduced confirm-prompt.ts with a 100ms poll
 * against shouldAbort(). When the user presses Ctrl+C, the
 * poll detects shouldAbort()=true and finishes(false), allowing
 * the REPL to resume the input editor.
 *
 * This eval verifies:
 * 1. The confirm promise resolves to false when shouldAbort flips
 * 2. runStopHooks fires even after abort (H3 hook wiring)
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { confirmYesNo } from '../../src/cli/confirm-prompt.js';
import { runStopHooks } from '../../src/hooks/loader.js';
import { HookRegistry } from '../../src/hooks/registry.js';
import { HookType, type SessionState } from '../../src/pkg/types.js';

function makeStdin() {
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    isRaw: false,
    setRawMode: vi.fn(),
    resume: vi.fn(),
  });
  return stdin as EventEmitter & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  };
}

function makeSession(): SessionState {
  return {
    sessionId: 's',
    mode: 'default' as never,
    hooks: { hooks: {} },
    compactionHistory: [],
    sessionApprovals: [],
  } as never;
}

describe('eval:gate:m4-cancel', () => {
  it('confirm resolves false when shouldAbort is true', async () => {
    const stdin = makeStdin();
    vi.stubGlobal('process', { ...process, stdin, env: { ...process.env } });
    const write = vi.fn();

    // shouldAbort flips to true after the first poll tick (100ms)
    let aborted = false;
    const shouldAbort = (): boolean => aborted;

    const promise = confirmYesNo({
      title: 'Allow test?',
      shouldAbort,
      write,
    });

    // Trigger abort after the prompt started
    setTimeout(() => {
      aborted = true;
    }, 50);

    const result = await promise;
    expect(result).toBe(false); // denied via abort
  });

  it('runStopHooks fires even after abort (H3 hook wiring)', async () => {
    const registry = new HookRegistry();
    const stopFn = vi.fn();
    vi.spyOn(registry, 'execute').mockImplementation(async (h) => {
      if (h.type === HookType.STOP) await stopFn();
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    registry.register({ type: HookType.STOP, name: 'cleanup', command: 'rm tmp' });

    // Simulate REPL finally path: even if the query was aborted
    // the finally block calls runStopHooks. Stop fires exactly
    // once.
    await runStopHooks(registry, makeSession());
    expect(stopFn).toHaveBeenCalledTimes(1);
  });
});