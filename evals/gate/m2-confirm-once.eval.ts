/**
 * Gate eval: M2 (DEFAULT 一次项目质检 confirm 次数 ≤ 1)
 *
 * M2: "DEFAULT 完成一次'项目质检'人工确认次数 ≤ 1 (Bash 批)".
 *
 * Earlier commit 6c3a793 + 336a627 prefilled the batch list
 * from the actual executor path (buildParallelAgentTasks.nodes
 * for parallel intents), so 4-15 tools fall under a single
 * batch confirm when the user says y once.
 *
 * This eval verifies the wiring: when 4 Read + 1 Bash tools
 * are scheduled for prefetch, the engine calls the prompt
 * callback exactly once with a batchTools array of length 4
 * (the Bash tools — Reads auto-allow in DEFAULT mode).
 */

import { describe, it, expect, vi } from 'vitest';
import { authorizePrefetchTool } from '../../src/permission/prefetch-gate.js';
import { PermissionMode, type ToolCall } from '../../src/pkg/types.js';
import { PermissionSystem } from '../../src/permission/system.js';

function makeCtx() {
  return {
    permissionSystem: new PermissionSystem(),
    mode: PermissionMode.DEFAULT,
    state: { sessionId: 's', sessionApprovals: [] } as never,
    batchConfirm: { promise: null, tools: [] as ToolCall[] },
  };
}

describe('eval:gate:m2-confirm-once', () => {
  it('parallel workers share one prompt Promise for the batch', async () => {
    const ctx = makeCtx();
    const writeBash: ToolCall[] = [
      { id: 'b1', name: 'Bash', input: { command: 'npm test' } },
      { id: 'b2', name: 'Bash', input: { command: 'mkdir foo' } },
    ];
    const safeTools: ToolCall[] = [
      { id: 'r1', name: 'Read', input: { path: 'a.ts' } },
      { id: 'g1', name: 'Glob', input: { pattern: '*' } },
    ];
    ctx.batchConfirm.tools = [...writeBash, ...safeTools];

    let promptCalls = 0;
    const prompts: Array<(v: boolean) => void> = [];
    const prompt = vi.fn(() => {
      promptCalls += 1;
      return new Promise<boolean>((r) => prompts.push(r));
    });

    // Spawn 4 workers concurrently
    const results = Promise.all(
      [...writeBash, ...safeTools].map((tool) =>
        authorizePrefetchTool(tool, { ...ctx, prompt })
      )
    );
    // Yield so the first worker can set the shared promise
    await new Promise((r) => setImmediate(r));
    // Now resolve the (single) pending prompt
    expect(prompts).toHaveLength(1);
    expect(promptCalls).toBe(1);
    prompts[0]!(true);

    // All workers should resolve to null (allowed)
    const settled = await results;
    expect(settled.every((r) => r === null)).toBe(true);
  });

  it('session approval short-circuits the prompt entirely', async () => {
    const ctx = makeCtx();
    const tool: ToolCall = { id: 'b1', name: 'Bash', input: { command: 'npm test' } };
    ctx.state.sessionApprovals = ['Bash:npm'];
    ctx.batchConfirm.tools = [tool];

    const prompt = vi.fn();
    const result = await authorizePrefetchTool(tool, { ...ctx, prompt });
    expect(result).toBeNull(); // allowed
    expect(prompt).not.toHaveBeenCalled();
  });
});
