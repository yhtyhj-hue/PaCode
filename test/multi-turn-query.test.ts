/**
 * 多轮对话执行逻辑 — QueryEngine + 消息序列
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryEngine } from '../src/agent/engine.js';
import { compileMessagesForApi } from '../src/services/context-compiler/index.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { PermissionMode, SessionState } from '../src/pkg/types.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
  toolUseScenario,
} from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

function createState(): SessionState {
  return {
    sessionId: 'multi-turn',
    messages: [],
    toolCallHistory: [],
    maxOutputTokensRecoveryCount: 0,
    mode: PermissionMode.BYPASS,
    hooks: { hooks: {} },
    compactionHistory: [],
  };
}

function registerStubs(registry: ToolRegistry): void {
  registry.register({
    name: 'Read',
    description: 'read',
    inputSchema: {},
    concurrencySafe: true,
    permissionMode: PermissionMode.BYPASS,
    async execute(input) {
      return { content: [{ type: 'text' as const, text: `content:${(input as { path: string }).path}` }] };
    },
  });
  registry.register({
    name: 'Bash',
    description: 'bash',
    inputSchema: {},
    concurrencySafe: true,
    permissionMode: PermissionMode.BYPASS,
    async execute() {
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    },
  });
  registry.register({
    name: 'Glob',
    description: 'glob',
    inputSchema: {},
    concurrencySafe: true,
    permissionMode: PermissionMode.BYPASS,
    async execute() {
      return { content: [{ type: 'text' as const, text: 'src/a.ts' }] };
    },
  });
}

describe('multi-turn query execution', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerStubs(registry);
    process.env['PACODE_PREFETCH_DAG'] = '1';
  });

  afterEach(() => {
    delete process.env['PACODE_PREFETCH_DAG'];
  });

  it('turn 1 prefetch + turn 2 continue produce valid API message chain', async () => {
    const client = createMockAnthropicClient([
      textEndTurnScenario('第一轮：基于预取的合格度评估'),
      textEndTurnScenario('第二轮：基于 engine.ts 的代码审计'),
    ]);

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });

    const state = createState();

    // Turn 1 — REPL 先 push 用户消息
    state.messages.push({
      role: 'user',
      content: '深度检查一下当前项目作为一个AI编程工具，是否合格？',
      timestamp: 1,
    });
    for await (const _ of engine.query(
      { message: '深度检查一下当前项目作为一个AI编程工具，是否合格？' },
      state
    )) {
      /* drain */
    }

    // Turn 2
    state.messages.push({ role: 'user', content: '继续啊', timestamp: 99 });
    for await (const _ of engine.query({ message: '继续啊' }, state)) {
      /* drain */
    }

    const roles = state.messages.map((m) => m.role);
    expect(roles.filter((r) => r === 'assistant')).toHaveLength(2);
    expect(state.messages.some((m) => typeof m.content === 'string' && m.content.includes('实现评估已完成'))).toBe(
      true
    );
    expect(state.messages.some((m) => typeof m.content === 'string' && m.content.includes('代码审计已完成'))).toBe(
      true
    );

    const { messages: apiMessages, issues } = compileMessagesForApi(state.messages);
    expect(issues.filter((i) => i.includes('orphan'))).toHaveLength(0);
    expect(apiMessages.length).toBeGreaterThanOrEqual(4);
  });

  it('single query tool loop persists assistant + tool_result pairs across turns', async () => {
    registry.register({
      name: 'Echo',
      description: 'echo',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.BYPASS,
      async execute(input) {
        return { content: [{ type: 'text' as const, text: String((input as { msg: string }).msg) }] };
      },
    });

    const client = createMockAnthropicClient([
      toolUseScenario('tu_1', 'Echo', { msg: 'ping' }),
      textEndTurnScenario('Done after tool'),
    ]);

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });

    const state = createState();
    state.messages.push({ role: 'user', content: 'echo ping', timestamp: 1 });

    for await (const _ of engine.query({ message: 'echo ping' }, state)) {
      /* drain */
    }

    expect(state.messages).toHaveLength(4);
    expect(state.messages[1]?.role).toBe('assistant');
    expect(state.messages[2]?.role).toBe('user');
    expect(state.messages[3]?.role).toBe('assistant');

    const { issues } = compileMessagesForApi(state.messages);
    expect(issues).toHaveLength(0);
  });

  it('each user turn resets prefetch (second inspect runs prefetch again)', async () => {
    const client = createMockAnthropicClient([
      textEndTurnScenario('第一次检查'),
      textEndTurnScenario('第二次检查'),
    ]);

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });

    const state = createState();

    state.messages.push({ role: 'user', content: '检查这个项目', timestamp: 1 });
    for await (const _ of engine.query({ message: '检查这个项目' }, state)) {
      /* drain */
    }

    const firstPrefetchCount = state.messages.filter(
      (m) => typeof m.content === 'string' && m.content.includes('项目检查已完成')
    ).length;

    state.messages.push({ role: 'user', content: '再检查一遍项目', timestamp: 2 });
    for await (const _ of engine.query({ message: '再检查一遍项目' }, state)) {
      /* drain */
    }

    const secondPrefetchCount = state.messages.filter(
      (m) => typeof m.content === 'string' && m.content.includes('项目检查已完成')
    ).length;

    expect(firstPrefetchCount).toBe(1);
    expect(secondPrefetchCount).toBe(2);
  });
});
