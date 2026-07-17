/**
 * E2E: Agent happy path — user → parallel prefetch → model summary
 *
 * 无真实 LLM；验证完整 QueryEngine 回路与会话注入。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryEngine } from '../../src/agent/engine.js';
import { serializeMessagesForApi } from '../../src/agent/message-serializer.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { registerCoreTools } from '../../src/tools/bootstrap.js';
import { PermissionMode } from '../../src/pkg/types.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
} from '../helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from '../helpers/engine-stubs.js';

function registerPrefetchStubs(registry: ToolRegistry): void {
  const stub = (name: string) => ({
    name,
    description: name,
    inputSchema: {},
    concurrencySafe: true,
    permissionMode: PermissionMode.BYPASS,
    async execute() {
      return { content: [{ type: 'text' as const, text: `${name}-ok` }] };
    },
  });
  registry.register(stub('Read'));
  registry.register(stub('Bash'));
  registry.register(stub('Glob'));
}

describe('e2e agent happy path', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerPrefetchStubs(registry);
    process.env['PACODE_PREFETCH_DAG'] = '1';
  });

  afterEach(() => {
    delete process.env['PACODE_PREFETCH_DAG'];
  });

  it('qualification review runs parallel agents then streams summary', async () => {
    const client = createMockAnthropicClient([
      textEndTurnScenario('## 合格度\n基于 npm test 摘要：通过。'),
    ]);

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });

    const state = {
      sessionId: 'e2e-happy',
      messages: [] as Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>,
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.BYPASS,
      hooks: { hooks: {} },
      compactionHistory: [],
    };

    const events = [];
    for await (const event of engine.query(
      {
        message: '深度检查一下当前项目作为一个AI编程工具，是否合格？',
      },
      state
    )) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'agents_running')).toBe(true);
    expect(events.some((e) => e.type === 'agents_complete')).toBe(true);
    expect(events.some((e) => e.type === 'prefetch_complete')).toBe(true);
    expect(events.some((e) => e.type === 'content_block_delta')).toBe(true);
    expect(events.some((e) => e.type === 'message_stop')).toBe(true);

    const injected = state.messages.find(
      (m) => typeof m.content === 'string' && m.content.includes('实现评估已完成')
    );
    expect(injected).toBeTruthy();

    const hasToolResultBlocks = serializeMessagesForApi(state.messages).some((m) => {
      const c = m.content;
      return Array.isArray(c) && c.some((b) => typeof b === 'object' && b !== null && 'tool_use_id' in b);
    });
    expect(hasToolResultBlocks).toBe(false);

    expect(state.messages.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('continue after review triggers code_audit prefetch', async () => {
    const client = createMockAnthropicClient([textEndTurnScenario('基于 engine.ts 片段的审计')]);

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });

    const state = {
      sessionId: 'e2e-continue',
      messages: [
        {
          role: 'user' as const,
          content: '深度检查项目作为AI编程工具是否合格？',
          timestamp: Date.now(),
        },
        { role: 'assistant' as const, content: '文档级评估', timestamp: Date.now() },
      ],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.BYPASS,
      hooks: { hooks: {} },
      compactionHistory: [],
    };

    for await (const _event of engine.query({ message: '继续啊' }, state)) {
      /* drain */
    }

    expect(
      state.messages.some(
        (m) => typeof m.content === 'string' && m.content.includes('代码审计已完成')
      )
    ).toBe(true);
  });

  it('continue with real Read tools injects engine.ts excerpt', async () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry, {
      task: { apiKey: 'test', model: 'test', toolRegistry: registry },
    });

    const streamParams: Record<string, unknown>[] = [];
    const client = createMockAnthropicClient(
      [textEndTurnScenario('审计完成')],
      (params) => streamParams.push(params)
    );
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      permissionPrompt: async () => true,
    });

    const state = {
      sessionId: 'e2e-real-read',
      messages: [
        {
          role: 'user' as const,
          content: '我让你自检是要去看完整的代码实现，不是看文档说明',
          timestamp: Date.now(),
        },
        { role: 'assistant' as const, content: '你说得对', timestamp: Date.now() },
      ],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    };

    const events: string[] = [];
    for await (const event of engine.query({ message: '继续啊' }, state)) {
      events.push(event.type);
    }

    const injected = state.messages.find(
      (m) => typeof m.content === 'string' && m.content.includes('代码审计已完成')
    );
    expect(injected).toBeTruthy();
    expect(String(injected?.content)).toMatch(/QueryEngine|while \(stop_reason/);
    expect(String(injected?.content)).not.toMatch(/User denied permission for prefetch batch/);
    // 预取后仍暴露 tools，允许模型继续深读
    expect(Array.isArray(streamParams[0]?.tools)).toBe(true);
    expect(events.some((t) => t === 'message_stop')).toBe(true);
  });
});
