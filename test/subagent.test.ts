/**
 * SubagentManager tests — mocked engine + SubagentStop hook
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SubagentManager } from '../src/agent/subagent.js';
import { QueryEngine } from '../src/agent/engine.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { HookRegistry } from '../src/hooks/registry.js';
import { PermissionMode, HookType, ToolDefinition } from '../src/pkg/types.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
  toolUseScenario,
} from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

function createMockEngine(scenarios: Parameters<typeof createMockAnthropicClient>[0]) {
  const client = createMockAnthropicClient(scenarios);
  return (opts: ConstructorParameters<typeof QueryEngine>[0]) =>
    new QueryEngine({
      ...opts,
      anthropicClient: client,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });
}

describe('SubagentManager', () => {
  let manager: SubagentManager;
  let parentRegistry: ToolRegistry;

  beforeEach(() => {
    manager = new SubagentManager();
    parentRegistry = new ToolRegistry();
    parentRegistry.register(createStubTool('Read'));
    parentRegistry.register(createStubTool('Edit'));
    parentRegistry.register(createStubTool('Grep'));
    parentRegistry.register(createStubTool('Glob'));
  });

  it('returns streamed output on success', async () => {
    manager.register({
      name: 'test-agent',
      description: 'test',
      mode: PermissionMode.BYPASS,
    });

    const result = await manager.run(manager.get('test-agent')!, 'explore codebase', {
      createEngine: createMockEngine([textEndTurnScenario('Found 3 files')]),
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe('Found 3 files');
    expect(result.name).toBe('test-agent');
  });

  it('filters tools for explore agent whitelist', async () => {
    const explore = {
      name: 'explore-test',
      description: 'read only',
      mode: PermissionMode.BYPASS,
      tools: ['Read', 'Grep', 'Glob'],
    };
    manager.register(explore);

    let capturedTools: string[] = [];
    const client = createMockAnthropicClient([textEndTurnScenario('ok')]);

    await manager.run(explore, 'scan', {
      toolRegistry: parentRegistry,
      createEngine: (opts) => {
        capturedTools = opts.toolRegistry?.list().map((t) => t.name) ?? [];
        return new QueryEngine({
          ...opts,
          anthropicClient: client,
          contextAssembler: stubAssembler(),
          compactionPipeline: passthroughCompaction(),
        });
      },
    });

    expect(capturedTools.sort()).toEqual(['Glob', 'Grep', 'Read']);
    expect(capturedTools).not.toContain('Edit');
  });

  it('counts tool_use events', async () => {
    manager.register({ name: 'worker', description: 'w', mode: PermissionMode.BYPASS });
    parentRegistry.register(createStubTool('Echo'));

    const result = await manager.run(manager.get('worker')!, 'do work', {
      toolRegistry: parentRegistry,
      createEngine: createMockEngine([
        toolUseScenario('tu_e', 'Echo', { msg: 'hi' }),
        textEndTurnScenario('done'),
      ]),
    });

    expect(result.toolCalls).toBe(1);
    expect(result.success).toBe(true);
  });

  it('fires SubagentStop hook on completion', async () => {
    manager.register({ name: 'hooked', description: 'h', mode: PermissionMode.BYPASS });

    const hooks = new HookRegistry();
    const executeSpy = vi.spyOn(hooks, 'execute').mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) as any;
    hooks.register({
      name: 'on-subagent-stop',
      type: HookType.SUBAGENT_STOP,
      command: 'true',
    });

    await manager.run(manager.get('hooked')!, 'finish', {
      hookRegistry: hooks,
      createEngine: createMockEngine([textEndTurnScenario('bye')]),
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0]?.[0]?.name).toBe('on-subagent-stop');
  });

  it('runParallel executes all agents concurrently', async () => {
    manager.register({ name: 'a1', description: 'a', mode: PermissionMode.BYPASS });
    manager.register({ name: 'a2', description: 'b', mode: PermissionMode.BYPASS });

    const results = await manager.runParallel(
      [
        { config: manager.get('a1')!, prompt: 'one' },
        { config: manager.get('a2')!, prompt: 'two' },
      ],
      { createEngine: createMockEngine([textEndTurnScenario('ok')]) }
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('fires SubagentStop hook on error path', async () => {
    manager.register({ name: 'err-agent', description: 'e', mode: PermissionMode.BYPASS });

    const hooks = new HookRegistry();
    const executeSpy = vi.spyOn(hooks, 'execute').mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) as any;
    hooks.register({
      name: 'on-subagent-error',
      type: HookType.SUBAGENT_STOP,
      command: 'true',
    });

    const client = {
      messages: {
        stream: vi.fn(() => {
          throw new Error('stream failed');
        }),
      },
    } as unknown as import('@anthropic-ai/sdk').default;

    const result = await manager.run(manager.get('err-agent')!, 'fail', {
      hookRegistry: hooks,
      createEngine: (opts) =>
        new QueryEngine({
          ...opts,
          anthropicClient: client,
          contextAssembler: stubAssembler(),
          compactionPipeline: passthroughCompaction(),
        }),
    });

    expect(result.success).toBe(false);
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });
});

function createStubTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: {},
    concurrencySafe: true,
    permissionMode: PermissionMode.BYPASS,
    async execute() {
      return { content: [{ type: 'text' as const, text: `${name}-ok` }] };
    },
  };
}
