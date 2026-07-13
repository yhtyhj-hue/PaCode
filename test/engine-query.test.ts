/**
 * QueryEngine.query() integration tests — mocked Anthropic stream
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryEngine } from '../src/agent/engine.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { HookRegistry } from '../src/hooks/registry.js';
import { PermissionSystem } from '../src/permission/system.js';
import { ContextAssembler } from '../src/context/assembler.js';
import { CompactionPipeline } from '../src/context/compaction.js';
import { PermissionMode, SessionState, ToolDefinition } from '../src/pkg/types.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
  toolUseScenario,
  maxTokensScenario,
} from './helpers/mock-anthropic.js';

function createState(mode = PermissionMode.BYPASS): SessionState {
  return {
    sessionId: 'query-test',
    messages: [],
    toolCallHistory: [],
    maxOutputTokensRecoveryCount: 0,
    mode,
    hooks: { hooks: {} },
    compactionHistory: [],
  };
}

function stubAssembler(): ContextAssembler {
  return {
    async assemble(state) {
      return {
        systemPrompt: 'test-system',
        messages: state.messages,
        tools: [],
        maxTokens: 8192,
        tokenCount: 50,
      };
    },
  } as unknown as ContextAssembler;
}

function passthroughCompaction(): CompactionPipeline {
  return { async run(ctx) { return ctx; } } as unknown as CompactionPipeline;
}

describe('QueryEngine.query()', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('streams text deltas and persists assistant message on end_turn', async () => {
    const client = createMockAnthropicClient([textEndTurnScenario('Hello there')]);
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });
    const state = createState();

    const events = [];
    for await (const event of engine.query({ message: 'hi' }, state)) {
      events.push(event);
    }

    const deltas = events.filter((e) => e.type === 'content_block_delta');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.delta?.text).toBe('Hello there');

    const stop = events.find((e) => e.type === 'message_stop');
    expect(stop?.stopReason).toBe('end_turn');
    expect(stop?.usage?.totalTokens).toBe(20);

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.role).toBe('assistant');
  });

  it('runs tool loop: tool_use → tool_result → end_turn', async () => {
    registry.register(createEchoTool());

    const client = createMockAnthropicClient([
      toolUseScenario('tu_1', 'Echo', { msg: 'ping' }),
      textEndTurnScenario('Done'),
    ]);

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      permissionPrompt: async () => true,
    });
    const state = createState(PermissionMode.DEFAULT);

    const events = [];
    for await (const event of engine.query({ message: 'run echo' }, state)) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'tool_use' && e.tool?.name === 'Echo')).toBe(true);
    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult?.result?.content[0]?.text).toBe('ping');
    expect(events.some((e) => e.type === 'message_stop')).toBe(true);

    // assistant + tool results user msg + final assistant
    expect(state.messages.length).toBeGreaterThanOrEqual(3);
    expect(state.toolCallHistory).toHaveLength(1);
  });

  it('denies tool execution in PLAN mode', async () => {
    registry.register(createEchoTool());

    const client = createMockAnthropicClient([
      toolUseScenario('tu_2', 'Echo', { msg: 'x' }),
      textEndTurnScenario('Plan mode — no tools executed'),
    ]);

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });
    const state = createState(PermissionMode.PLAN);

    const events = [];
    for await (const event of engine.query({ message: 'plan only' }, state)) {
      events.push(event);
    }

    const denied = events.find((e) => e.type === 'tool_result');
    expect(denied?.result?.isError).toBe(true);
    expect(denied?.result?.content[0]?.text).toContain('Permission denied');
  });

  it('blocks tool when permission prompt returns false', async () => {
    registry.register(createEchoTool());

    const client = createMockAnthropicClient([
      toolUseScenario('tu_3', 'Echo', { msg: 'nope' }),
      textEndTurnScenario('Permission denied by user'),
    ]);

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      permissionSystem: new PermissionSystem(),
      permissionPrompt: async () => false,
    });
    const state = createState(PermissionMode.DEFAULT);

    const events = [];
    for await (const event of engine.query({ message: 'confirm deny' }, state)) {
      events.push(event);
    }

    const denied = events.find((e) => e.type === 'tool_result');
    expect(denied?.result?.content[0]?.text).toContain('User denied permission');
  });

  it('retries after max_tokens then completes', async () => {
    const client = createMockAnthropicClient([
      maxTokensScenario(),
      textEndTurnScenario('Recovered'),
    ]);

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });
    const state = createState();

    const events = [];
    for await (const event of engine.query({ message: 'retry me' }, state)) {
      events.push(event);
    }

    expect(state.maxOutputTokensRecoveryCount).toBe(1);
    expect(events.some((e) => e.type === 'message_stop')).toBe(true);
    expect(state.messages.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('executes consecutive concurrencySafe tools in parallel', async () => {
    const order: string[] = [];

    registry.register({
      name: 'SlowRead',
      description: 'slow read',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.BYPASS,
      async execute() {
        order.push('start-read');
        await Promise.resolve();
        order.push('end-read');
        return { content: [{ type: 'text', text: 'read-ok' }] };
      },
    });

    registry.register({
      name: 'SlowGrep',
      description: 'slow grep',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.BYPASS,
      async execute() {
        order.push('start-grep');
        await Promise.resolve();
        order.push('end-grep');
        return { content: [{ type: 'text', text: 'grep-ok' }] };
      },
    });

    const client = createMockAnthropicClient([
      toolUseScenario('tu_r', 'SlowRead', {}),
      toolUseScenario('tu_g', 'SlowGrep', {}),
      textEndTurnScenario('both done'),
    ]);

    // 两次 tool_use 分两轮（单轮多 tool block 由 model-stream 单测覆盖）
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });
    const state = createState();

    for await (const _event of engine.query({ message: 'parallel' }, state)) {
      /* drain */
    }

    expect(order).toEqual(['start-read', 'end-read', 'start-grep', 'end-grep']);
  });

  it('yields error event when stream throws', async () => {
    const client = {
      messages: {
        stream: vi.fn(() => {
          throw new Error('API unavailable');
        }),
      },
    } as unknown as import('@anthropic-ai/sdk').default;

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });

    const events = [];
    for await (const event of engine.query({ message: 'fail' }, createState())) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'error' && e.error?.message.includes('API unavailable'))).toBe(
      true
    );
  });
});

function createEchoTool(): ToolDefinition {
  return {
    name: 'Echo',
    description: 'echo',
    inputSchema: {},
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      return { content: [{ type: 'text', text: String((input as { msg: string }).msg) }] };
    },
  };
}
