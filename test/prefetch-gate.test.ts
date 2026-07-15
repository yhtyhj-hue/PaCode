/**
 * Prefetch permission gate
 */

import { describe, it, expect, vi } from 'vitest';
import { PermissionMode } from '../src/pkg/types.js';
import { PermissionSystem } from '../src/permission/system.js';
import { authorizePrefetchTool, PrefetchBatchConfirm } from '../src/permission/prefetch-gate.js';

function tool(name: string, input: Record<string, unknown> = {}) {
  return { id: `t_${Math.random().toString(36).slice(2, 8)}`, name, input };
}

/** npm run 不是 readonly bash，DEFAULT 下需确认 */
const BASH_NEED_CONFIRM = { command: 'npm test' };

describe('authorizePrefetchTool', () => {
  it('denies via deny rules without prompting', async () => {
    const prompt = vi.fn().mockResolvedValue(true);
    const batch: PrefetchBatchConfirm = { promise: null, tools: [] };
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

  it('auto-allows Read in DEFAULT without prompting', async () => {
    const prompt = vi.fn();
    const batch: PrefetchBatchConfirm = { promise: null, tools: [] };
    const allowed = await authorizePrefetchTool(tool('Read', { path: 'a.ts' }), {
      permissionSystem: new PermissionSystem(),
      mode: PermissionMode.DEFAULT,
      state: { sessionId: 's' } as never,
      prompt,
      batchConfirm: batch,
    });
    expect(allowed).toBeNull();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('batch-confirms only once under parallel Bash callers', async () => {
    let resolvePrompt!: (v: boolean) => void;
    const prompt = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePrompt = resolve;
        })
    );
    const tools = [
      tool('Bash', BASH_NEED_CONFIRM),
      tool('Bash', { command: 'npm run build' }),
      tool('Bash', { command: 'node script.js' }),
    ];
    const batch: PrefetchBatchConfirm = { promise: null, tools };
    const sys = new PermissionSystem();
    const state = { sessionId: 's' } as never;
    const ctx = {
      permissionSystem: sys,
      mode: PermissionMode.DEFAULT,
      state,
      prompt,
      batchConfirm: batch,
    };

    const p1 = authorizePrefetchTool(tools[0]!, ctx);
    const p2 = authorizePrefetchTool(tools[1]!, ctx);
    const p3 = authorizePrefetchTool(tools[2]!, ctx);

    await Promise.resolve();
    expect(prompt).toHaveBeenCalledTimes(1);
    resolvePrompt(true);

    const results = await Promise.all([p1, p2, p3]);
    expect(results.every((r) => r === null)).toBe(true);
  });

  it('skips prompt in BYPASS mode', async () => {
    const prompt = vi.fn();
    const batch: PrefetchBatchConfirm = { promise: null, tools: [] };
    const allowed = await authorizePrefetchTool(tool('Bash', BASH_NEED_CONFIRM), {
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

describe('batch tools pre-population', () => {
  it('passes interactive-only batch list to prompt', async () => {
    let receivedBatch: unknown;
    const prompt = vi.fn(async (_t, batch) => {
      receivedBatch = batch;
      return true;
    });
    const tools = [
      tool('Read', { path: 'a.ts' }),
      tool('Bash', BASH_NEED_CONFIRM),
      tool('Bash', { command: 'npm run lint' }),
      tool('Glob', { pattern: '**/*' }),
    ];
    const batch: PrefetchBatchConfirm = { promise: null, tools };
    await authorizePrefetchTool(tools[1]!, {
      permissionSystem: new PermissionSystem(),
      mode: PermissionMode.DEFAULT,
      state: { sessionId: 's' } as never,
      prompt,
      batchConfirm: batch,
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(Array.isArray(receivedBatch)).toBe(true);
    expect((receivedBatch as { name: string }[]).every((t) => t.name === 'Bash')).toBe(true);
    expect((receivedBatch as unknown[]).length).toBe(2);
  });
});
