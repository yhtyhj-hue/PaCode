/**
 * Prefetch permission gate
 */

import { describe, it, expect, vi } from 'vitest';
import { PermissionMode } from '../src/pkg/types.js';
import { PermissionSystem } from '../src/permission/system.js';
import { authorizePrefetchTool, PrefetchBatchConfirm } from '../src/permission/prefetch-gate.js';

function tool(name: string, input: Record<string, unknown> = {}) {
  return { id: 't1', name, input };
}

describe('authorizePrefetchTool', () => {
  it('denies via deny rules without prompting', async () => {
    const prompt = vi.fn().mockResolvedValue(true);
    const batch: PrefetchBatchConfirm = { promise: null };
    const blocked = await authorizePrefetchTool(tool('Bash', { command: 'rm -rf /' }), {
      permissionSystem: new PermissionSystem({
        rules: { deny: ['Bash(rm *)'] },
      }),
      mode: PermissionMode.DEFAULT,
      state: { sessionId: 's' } as never,
      prompt,
      batchConfirm: batch,
    });
    expect(blocked?.isError).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('batch-confirms only once under parallel callers', async () => {
    let resolvePrompt!: (v: boolean) => void;
    const prompt = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePrompt = resolve;
        })
    );
    const batch: PrefetchBatchConfirm = { promise: null };
    const sys = new PermissionSystem();
    const state = { sessionId: 's' } as never;
    const ctx = {
      permissionSystem: sys,
      mode: PermissionMode.DEFAULT,
      state,
      prompt,
      batchConfirm: batch,
    };

    const p1 = authorizePrefetchTool(tool('Read', { path: 'a.ts' }), ctx);
    const p2 = authorizePrefetchTool(tool('Bash', { command: 'ls' }), ctx);
    const p3 = authorizePrefetchTool(tool('Glob', { pattern: '**/*' }), ctx);

    // 让出 microtask，确保三者都挂上同一 promise
    await Promise.resolve();
    expect(prompt).toHaveBeenCalledTimes(1);
    resolvePrompt(true);

    const results = await Promise.all([p1, p2, p3]);
    expect(results.every((r) => r === null)).toBe(true);
  });

  it('skips prompt in BYPASS mode', async () => {
    const prompt = vi.fn();
    const batch: PrefetchBatchConfirm = { promise: null };
    const allowed = await authorizePrefetchTool(tool('Bash', { command: 'ls' }), {
      permissionSystem: new PermissionSystem(),
      mode: PermissionMode.BYPASS,
      state: { sessionId: 's' } as never,
      prompt,
      batchConfirm: batch,
    });
    expect(allowed).toBeNull();
    expect(prompt).not.toHaveBeenCalled();
  });
});
