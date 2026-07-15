/**
 * Parallel tool executor tests
 */

import { describe, it, expect, vi } from 'vitest';
import { executeToolCallsInOrder } from '../src/agent/tool-executor.js';
import { ToolCall, ToolDefinition, PermissionMode } from '../src/pkg/types.js';

function makeDef(name: string, safe: boolean): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: {},
    concurrencySafe: safe,
    permissionMode: PermissionMode.DEFAULT,
    async execute() {
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    },
  };
}

describe('executeToolCallsInOrder', () => {
  it('runs consecutive safe tools in parallel', async () => {
    const order: string[] = [];
    const executeOne = vi.fn(async (call: ToolCall) => {
      order.push(`start-${call.name}`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`end-${call.name}`);
      return { content: [{ type: 'text' as const, text: call.name }] };
    });

    const defs = new Map([
      ['Read', makeDef('Read', true)],
      ['Grep', makeDef('Grep', true)],
    ]);

    await executeToolCallsInOrder({
      toolCalls: [
        { id: '1', name: 'Read', input: {} },
        { id: '2', name: 'Grep', input: {} },
      ],
      getDefinition: (n) => defs.get(n),
      executeOne,
    });

    expect(executeOne).toHaveBeenCalledTimes(2);
    // 并行：两个 start 应出现在任一 end 之前
    const firstEnd = order.findIndex((e) => e.startsWith('end-'));
    const startsBeforeEnd = order.filter((e) => e.startsWith('start-')).length;
    expect(startsBeforeEnd).toBe(2);
    expect(firstEnd).toBeGreaterThan(0);
  });

  it('runs unsafe tools sequentially after safe batch', async () => {
    const executeOne = vi.fn(async (call: ToolCall) => ({
      content: [{ type: 'text' as const, text: call.name }],
    }));

    const defs = new Map([
      ['Read', makeDef('Read', true)],
      ['Bash', makeDef('Bash', false)],
    ]);

    const outcomes = await executeToolCallsInOrder({
      toolCalls: [
        { id: '1', name: 'Read', input: {} },
        { id: '2', name: 'Bash', input: {} },
      ],
      getDefinition: (n) => defs.get(n),
      executeOne,
    });

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.toolCall.name).toBe('Read');
    expect(outcomes[1]!.toolCall.name).toBe('Bash');
  });

  it('preserves order for mixed safe/unsafe/safe pattern', async () => {
    const defs = new Map([
      ['Read', makeDef('Read', true)],
      ['Edit', makeDef('Edit', false)],
      ['Glob', makeDef('Glob', true)],
    ]);

    const outcomes = await executeToolCallsInOrder({
      toolCalls: [
        { id: '1', name: 'Read', input: {} },
        { id: '2', name: 'Edit', input: {} },
        { id: '3', name: 'Glob', input: {} },
      ],
      getDefinition: (n) => defs.get(n),
      executeOne: async (call) => ({ content: [{ type: 'text' as const, text: call.name }] }),
    });

    expect(outcomes.map((o) => o.toolCall.name)).toEqual(['Read', 'Edit', 'Glob']);
  });
});
