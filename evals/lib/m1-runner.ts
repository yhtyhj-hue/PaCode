/**
 * Periodic M1 — 假完成：质检意图下 end_turn 无 tool → 必须 TOOL_REQUIRED / nudge 失败
 */

import { QueryEngine } from '../../src/agent/engine.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { PermissionMode, type QueryEvent, type SessionState } from '../../src/pkg/types.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
  toolUseScenario,
} from '../../test/helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from '../../test/helpers/engine-stubs.js';

const DEEP_CHECK = '对这个项目做一次深度质检';

function createState(): SessionState {
  return {
    sessionId: 'm1-periodic',
    messages: [],
    toolCallHistory: [],
    maxOutputTokensRecoveryCount: 0,
    mode: PermissionMode.BYPASS,
    hooks: { hooks: {} },
    compactionHistory: [],
  };
}

function registerReadStub(registry: ToolRegistry): void {
  registry.register({
    name: 'Read',
    description: 'read',
    inputSchema: {},
    concurrencySafe: true,
    permissionMode: PermissionMode.BYPASS,
    async execute(input) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `ok:${(input as { path?: string }).path ?? ''}`,
          },
        ],
      };
    },
  });
}

async function collectEvents(
  engine: QueryEngine,
  message: string,
  state: SessionState
): Promise<QueryEvent[]> {
  const events: QueryEvent[] = [];
  for await (const event of engine.query({ message }, state)) {
    events.push(event);
  }
  return events;
}

/** 假完成：模型直接声称完成 → 引擎应 TOOL_REQUIRED（或等价 error） */
export async function runM1FakeCompletionCase(): Promise<{
  passed: boolean;
  detail: string;
}> {
  const registry = new ToolRegistry();
  registerReadStub(registry);
  const client = createMockAnthropicClient([
    textEndTurnScenario('检查完成，项目完全合格，无需改动。'),
    textEndTurnScenario('仍然检查完成。'),
    textEndTurnScenario('第三次仍无工具。'),
  ]);
  const engine = new QueryEngine({
    anthropicClient: client,
    toolRegistry: registry,
    contextAssembler: stubAssembler(),
    compactionPipeline: passthroughCompaction(),
    prefetch: { enabled: false },
  });
  const events = await collectEvents(engine, DEEP_CHECK, createState());
  const toolRequired = events.some(
    (e) => e.type === 'error' && (e.error?.code === 'TOOL_REQUIRED' || /TOOL_REQUIRED|tool/i.test(e.error?.message ?? ''))
  );
  const usedTools = events.some((e) => e.type === 'tool_result' || e.type === 'tool_use');
  // 假完成路径：不得静默 message_stop 成功且无工具
  const silentSuccess =
    !toolRequired &&
    !usedTools &&
    events.some((e) => e.type === 'message_stop');
  const passed = toolRequired && !silentSuccess;
  return {
    passed,
    detail: passed
      ? 'TOOL_REQUIRED on fake completion'
      : `expected TOOL_REQUIRED; toolRequired=${toolRequired} silentSuccess=${silentSuccess}`,
  };
}

/** 正例：模型调 Read 再结束 → 不应因假完成失败 */
export async function runM1EvidenceCase(): Promise<{
  passed: boolean;
  detail: string;
}> {
  const registry = new ToolRegistry();
  registerReadStub(registry);
  const client = createMockAnthropicClient([
    toolUseScenario('tu1', 'Read', { path: 'package.json' }),
    textEndTurnScenario('基于 Read 结果：依赖齐全。'),
  ]);
  const engine = new QueryEngine({
    anthropicClient: client,
    toolRegistry: registry,
    contextAssembler: stubAssembler(),
    compactionPipeline: passthroughCompaction(),
    prefetch: { enabled: false },
  });
  const events = await collectEvents(engine, DEEP_CHECK, createState());
  const usedTools = events.some(
    (e) =>
      e.type === 'tool_result' ||
      (e.type === 'content_block_start' &&
        // tool_use blocks appear in stream; also tool_result events
        true)
  );
  const hasToolResult = events.some((e) => e.type === 'tool_result');
  const toolRequired = events.some(
    (e) => e.type === 'error' && e.error?.code === 'TOOL_REQUIRED'
  );
  const passed = hasToolResult && !toolRequired;
  return {
    passed,
    detail: passed
      ? 'evidence path ok'
      : `hasToolResult=${hasToolResult} toolRequired=${toolRequired} usedTools=${usedTools}`,
  };
}

export function scoreM1Suite(results: Array<{ passed: boolean }>): number {
  if (results.length === 0) return 1;
  return results.filter((r) => r.passed).length / results.length;
}
