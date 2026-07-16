/**
 * H3 hook wiring: PostToolUseFailure + Stop hooks
 */

import { describe, it, expect, vi } from 'vitest';
import { HookRegistry } from '../src/hooks/registry.js';
import { runStopHooks } from '../src/hooks/loader.js';
import { HookType, type SessionState, type ToolContext } from '../src/pkg/types.js';

function makeSession(): SessionState {
  return {
    sessionId: 's1',
    mode: 'default' as never,
    hooks: { hooks: {} },
    compactionHistory: [],
    sessionApprovals: [],
  } as never;
}

describe('H3 PostToolUseFailure', () => {
  it('fires PostToolUseFailure hook when tool throws', async () => {
    const hooks = new HookRegistry();
    const failHook = vi.fn().mockResolvedValue(undefined);
    hooks.register({
      type: HookType.POST_TOOL_USE_FAILURE,
      name: 'log-fail',
      command: 'echo fail',
    });
    vi.spyOn(hooks, 'execute').mockImplementation(async (h) => {
      if (h.type === HookType.POST_TOOL_USE_FAILURE) {
        await failHook();
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const failHooks = hooks.findMatching(HookType.POST_TOOL_USE_FAILURE, {} as ToolContext);
    expect(failHooks).toHaveLength(1);
    expect(failHooks[0]?.name).toBe('log-fail');

    for (const h of failHooks) {
      await hooks.execute(h);
    }
    expect(failHook).toHaveBeenCalledTimes(1);
  });
});

describe('H3 Stop hook', () => {
  it('runStopHooks fires registered Stop hooks', async () => {
    const hooks = new HookRegistry();
    const stopFn = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(hooks, 'execute').mockImplementation(async (h) => {
      if (h.type === HookType.STOP) await stopFn();
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    hooks.register({ type: HookType.STOP, name: 'cleanup', command: 'rm tmp' });

    await runStopHooks(hooks, makeSession());
    expect(stopFn).toHaveBeenCalledTimes(1);
  });

  it('swallows hook errors without throwing', async () => {
    const hooks = new HookRegistry();
    vi.spyOn(hooks, 'execute').mockRejectedValue(new Error('boom'));
    hooks.register({ type: HookType.STOP, name: 'broken', command: 'fail' });

    // Must not throw — Stop hook failures are isolated
    await expect(runStopHooks(hooks, makeSession())).resolves.toBeUndefined();
  });

  it('does nothing when no Stop hook registered', async () => {
    const hooks = new HookRegistry();
    const execSpy = vi.spyOn(hooks, 'execute');
    await runStopHooks(hooks, makeSession());
    expect(execSpy).not.toHaveBeenCalled();
  });
});