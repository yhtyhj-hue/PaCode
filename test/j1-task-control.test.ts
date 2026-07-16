/**
 * J1 — Task 结果可见性 + TaskList / TaskGet / TaskStop
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerTaskTool } from '../src/tools/task.js';
import { registerTaskControlTools } from '../src/tools/task-control.js';
import { getSubagentManager, resetSubagentManager } from '../src/agent/subagent.js';
import { getTaskStore, resetTaskStore } from '../src/services/task-registry/index.js';
import { PermissionMode } from '../src/pkg/types.js';
import { registryWithoutTask } from '../src/agent/subagent.js';

describe('J1 TaskStore + control tools', () => {
  beforeEach(() => {
    resetTaskStore();
    resetSubagentManager();
  });

  afterEach(() => {
    resetTaskStore();
    resetSubagentManager();
    vi.restoreAllMocks();
  });

  it('sync Task records id and TaskGet returns report', async () => {
    vi.spyOn(getSubagentManager(), 'run').mockResolvedValue({
      name: 'explore',
      success: true,
      output: 'found files',
      toolCalls: 1,
      duration: 50,
      report: {
        agent: 'explore',
        success: true,
        summary: 'found files',
        toolCalls: 1,
        durationMs: 50,
        isolation: 'none',
      },
    });

    const registry = new ToolRegistry();
    registerTaskTool(registry, { toolRegistry: registry });
    registerTaskControlTools(registry);

    const result = await registry.execute(
      {
        id: '1',
        name: 'Task',
        input: { description: 'scan', prompt: 'find ts', subagent_type: 'explore' },
      },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );

    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/task_id: task_/);
    const id = text.match(/task_id: (task_\S+)/)?.[1];
    expect(id).toBeTruthy();

    const listed = await registry.execute(
      { id: '2', name: 'TaskList', input: {} },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );
    expect((listed.content[0] as { text: string }).text).toContain(id!);

    const got = await registry.execute(
      { id: '3', name: 'TaskGet', input: { task_id: id } },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );
    const body = JSON.parse((got.content[0] as { text: string }).text);
    expect(body.status).toBe('done');
    expect(body.report.summary).toBe('found files');
  });

  it('background Task + TaskStop signals abort', async () => {
    let sawAbort = false;
    vi.spyOn(getSubagentManager(), 'run').mockImplementation(async (_c, _p, opts) => {
      for (let i = 0; i < 50; i++) {
        if (opts?.shouldAbort?.()) {
          sawAbort = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      return {
        name: 'general-purpose',
        success: !sawAbort,
        output: sawAbort ? 'stopped' : 'done',
        toolCalls: 0,
        duration: 1,
        report: {
          agent: 'general-purpose',
          success: !sawAbort,
          summary: sawAbort ? 'stopped' : 'done',
          toolCalls: 0,
          durationMs: 1,
          isolation: 'none',
        },
      };
    });

    const registry = new ToolRegistry();
    registerTaskTool(registry, { toolRegistry: registry });
    registerTaskControlTools(registry);

    const started = await registry.execute(
      {
        id: '1',
        name: 'Task',
        input: {
          description: 'long',
          prompt: 'work',
          run_in_background: true,
        },
      },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );

    const meta = JSON.parse((started.content[0] as { text: string }).text);
    expect(meta.status).toBe('running');
    expect(meta.task_id).toBeTruthy();

    const stop = await registry.execute(
      { id: '2', name: 'TaskStop', input: { task_id: meta.task_id } },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );
    expect(stop.isError).toBeFalsy();

    await new Promise((r) => setTimeout(r, 80));
    expect(sawAbort).toBe(true);

    const task = getTaskStore().get(meta.task_id);
    expect(task?.status === 'stopped' || task?.status === 'done' || task?.status === 'error').toBe(
      true
    );
  });

  it('registryWithoutTask strips Task control tools', () => {
    const reg = new ToolRegistry();
    reg.register({
      name: 'Read',
      description: 'r',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.BYPASS,
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    });
    registerTaskTool(reg, { toolRegistry: reg });
    registerTaskControlTools(reg);
    const filtered = registryWithoutTask(reg);
    expect(filtered.has('Read')).toBe(true);
    expect(filtered.has('Task')).toBe(false);
    expect(filtered.has('TaskList')).toBe(false);
    expect(filtered.has('TaskGet')).toBe(false);
    expect(filtered.has('TaskStop')).toBe(false);
  });
});
