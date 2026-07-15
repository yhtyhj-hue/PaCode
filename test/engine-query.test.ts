/**
 * QueryEngine.query() integration tests — mocked Anthropic stream
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryEngine } from '../src/agent/engine.js';
import { serializeMessagesForApi } from '../src/agent/message-serializer.js';
import { ToolRegistry } from '../src/tools/registry.js';
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
    async assemble(state: any) {
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
  return { async run(ctx: any) { return ctx; } } as unknown as CompactionPipeline;
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
    expect((toolResult?.result?.content[0] as { type: 'text'; text: string })?.text).toBe('ping');
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
    expect((denied?.result?.content[0] as { type: 'text'; text: string })?.text).toContain('Permission denied');
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
    expect((denied?.result?.content[0] as { type: 'text'; text: string })?.text).toContain('User denied permission');
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
        return { content: [{ type: 'text' as const, text: 'read-ok' }] };
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
        return { content: [{ type: 'text' as const, text: 'grep-ok' }] };
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

  it('DAG prefetch asks permission once in DEFAULT mode (batch confirm)', async () => {
    registerBootstrapStubs(registry);
    const permissionPrompt = vi.fn().mockResolvedValue(true);

    const client = createMockAnthropicClient([textEndTurnScenario('分析完成')]);
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      permissionPrompt,
    });

    const state = createState(PermissionMode.DEFAULT);
    for await (const _ of engine.query({ message: '检查这个项目' }, state)) {
      /* drain */
    }

    expect(permissionPrompt.mock.calls.length).toBe(1);
  });

  it('DAG prefetch respects denied batch confirm', async () => {
    registerBootstrapStubs(registry);
    const permissionPrompt = vi.fn().mockResolvedValue(false);

    const client = createMockAnthropicClient([textEndTurnScenario('无法预取')]);
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      permissionPrompt,
    });

    const state = createState(PermissionMode.DEFAULT);
    for await (const _ of engine.query({ message: '检查这个项目' }, state)) {
      /* drain */
    }

    expect(permissionPrompt).toHaveBeenCalled();
    const audit = state.messages.find(
      (m) => typeof m.content === 'string' && m.content.includes('项目检查已完成')
    );
    expect(String(audit?.content ?? '')).toMatch(/Permission denied|User denied permission/);
  });

  it('keeps tools available after DAG prefetch (CC-aligned agent loop)', async () => {
    registerBootstrapStubs(registry);
    registry.register(createEchoTool());

    const streamParams: Record<string, unknown>[] = [];
    const client = createMockAnthropicClient(
      [textEndTurnScenario('分析完成')],
      (params) => streamParams.push(params)
    );

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      permissionPrompt: async () => true,
    });

    const state = createState(PermissionMode.DEFAULT);
    state.messages.push({ role: 'user', content: '分析这个项目', timestamp: Date.now() });

    const events = [];
    for await (const event of engine.query({}, state)) {
      events.push(event);
    }

    expect(Array.isArray(streamParams[0]?.tools)).toBe(true);
    expect((streamParams[0]?.tools as unknown[]).length).toBeGreaterThan(0);
    const prefetch = events.find((e) => e.type === 'prefetch_complete');
    expect(prefetch?.prefetchTools?.length).toBe(15);
    expect(events.some((e) => e.type === 'message_stop')).toBe(true);
  });

  it('stores bootstrap as user text not tool_result blocks', async () => {
    registerBootstrapStubs(registry);

    const client = createMockAnthropicClient([textEndTurnScenario('总结')]);
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });

    const state = createState(PermissionMode.BYPASS);
    state.messages.push({ role: 'user', content: '检查这个项目', timestamp: Date.now() });

    for await (const _event of engine.query({}, state)) {
      /* drain */
    }

    const bootstrapMsg = state.messages.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('项目检查已完成')
    );
    expect(bootstrapMsg).toBeTruthy();
    expect(serializeMessagesForApi(state.messages).some((m) => {
      const c = m.content;
      return Array.isArray(c) && c.some((b) => typeof b === 'object' && b !== null && 'tool_use_id' in b);
    })).toBe(false);
  });

  it('runs review_implementation prefetch with expanded tool set', async () => {
    registerBootstrapStubs(registry);
    registry.register({
      name: 'Glob',
      description: 'glob',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.BYPASS,
      async execute() {
        return { content: [{ type: 'text' as const, text: 'src/agent/engine.ts' }] };
      },
    });

    const client = createMockAnthropicClient([textEndTurnScenario('优化建议')]);
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });

    const state = createState(PermissionMode.BYPASS);
    state.messages.push({
      role: 'user',
      content: '你检查一下当前项目的实现情况，看哪里可以优化？',
      timestamp: Date.now(),
    });

    const events = [];
    for await (const event of engine.query({}, state)) {
      events.push(event);
    }

    const prefetch = events.find((e) => e.type === 'prefetch_complete');
    expect(prefetch?.prefetchTools?.length).toBe(16);
    expect(
      state.messages.some(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.includes('实现评估已完成')
      )
    ).toBe(true);
  });

  it('runs bootstrap before model when inspecting project', async () => {
    registerBootstrapStubs(registry);
    registry.register({
      name: 'Glob',
      description: 'glob',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.BYPASS,
      async execute() {
        return { content: [{ type: 'text' as const, text: 'src/agent/engine.ts' }] };
      },
    });

    const streamParams: Record<string, unknown>[] = [];
    const client = createMockAnthropicClient(
      [textEndTurnScenario('根据检查结果总结')],
      (params) => streamParams.push(params)
    );

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });

    const state = createState(PermissionMode.BYPASS);
    state.messages.push({ role: 'user', content: '检查当前项目', timestamp: Date.now() });

    const events = [];
    for await (const event of engine.query({}, state)) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'prefetch_complete' && e.prefetchTools?.some((t) => t.name === 'Read'))).toBe(
      true
    );
    const prefetch = events.find((e) => e.type === 'prefetch_complete');
    expect(prefetch?.prefetchTools?.length).toBe(15);
    expect(streamParams.length).toBe(1);
    expect(events.some((e) => e.type === 'message_stop')).toBe(true);
  });

  it('omits tools from API request in PLAN mode', async () => {
    registry.register(createEchoTool());

    const streamParams: Record<string, unknown>[] = [];
    const client = createMockAnthropicClient(
      [textEndTurnScenario('Planning only')],
      (params) => streamParams.push(params)
    );

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });
    const state = createState(PermissionMode.PLAN);

    for await (const _event of engine.query({ message: 'plan' }, state)) {
      /* drain */
    }

    expect(streamParams[0]?.tools).toBeUndefined();
    expect(streamParams[0]?.tool_choice).toBeUndefined();
  });

  it('aborts query when shouldAbort returns true', async () => {
    const client = createMockAnthropicClient([
      textEndTurnScenario('Should not finish'),
      textEndTurnScenario('Second turn'),
    ]);

    let abortAfterFirstDelta = false;
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });

    const events = [];
    for await (const event of engine.query(
      {
        message: 'abort me',
        options: {
          shouldAbort: () => abortAfterFirstDelta,
        },
      },
      createState()
    )) {
      events.push(event);
      if (event.type === 'content_block_delta') {
        abortAfterFirstDelta = true;
      }
    }

    expect(events.some((e) => e.type === 'error' && e.error?.code === 'ABORTED')).toBe(true);
    expect(events.filter((e) => e.type === 'message_stop')).toHaveLength(0);
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
      return { content: [{ type: 'text' as const, text: String((input as { msg: string }).msg) }] };
    },
  };
}

function registerBootstrapStubs(registry: ToolRegistry): void {
  const stub = (name: string) => ({
    name,
    description: name,
    inputSchema: {},
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute() {
      return { content: [{ type: 'text' as const, text: `${name}-ok` }] };
    },
  });
  registry.register(stub('Read'));
  registry.register(stub('Bash'));
  registry.register(stub('Glob'));
}
