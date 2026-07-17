/**
 * ensureLatestUserTextMessage — 关预取时 query({message}) 不得发空 messages
 */

import { describe, it, expect } from 'vitest';
import {
  ensureLatestUserTextMessage,
  mergeToolCallsFromFinalMessage,
  QueryEngine,
} from '../src/agent/engine.js';
import { PermissionMode } from '../src/pkg/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
} from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

describe('ensureLatestUserTextMessage', () => {
  it('appends user message when history empty', () => {
    const state = {
      sessionId: 's',
      messages: [] as Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>,
      mode: PermissionMode.DEFAULT,
    } as never;
    ensureLatestUserTextMessage(state, 'hello');
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe('hello');
  });

  it('does not duplicate identical trailing user text', () => {
    const state = {
      sessionId: 's',
      messages: [{ role: 'user' as const, content: 'hello', timestamp: 1 }],
      mode: PermissionMode.DEFAULT,
    } as never;
    ensureLatestUserTextMessage(state, 'hello');
    expect(state.messages).toHaveLength(1);
  });
});

describe('QueryEngine message bootstrap', () => {
  it('sends non-empty messages when prefetch disabled and only request.message set', async () => {
    let captured: unknown[] | undefined;
    const client = createMockAnthropicClient(
      [textEndTurnScenario('ok')],
      (params) => {
        captured = params['messages'] as unknown[];
      }
    );
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: new ToolRegistry(),
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      prefetch: { enabled: false },
    });
    const state = {
      sessionId: 'm5-bootstrap',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.BYPASS,
      hooks: { hooks: {} },
      compactionHistory: [],
    } as never;

    for await (const _ of engine.query({ message: 'fix the bug in add.js' }, state)) {
      /* drain */
    }

    expect(Array.isArray(captured)).toBe(true);
    expect((captured as unknown[]).length).toBeGreaterThan(0);
    expect(state.messages.some((m: { role: string }) => m.role === 'user')).toBe(true);
  });
});

describe('mergeToolCallsFromFinalMessage', () => {
  it('backfills tool_use from finalMessage when stream missed them', () => {
    const event = {
      type: 'model_complete' as const,
      stopReason: 'end_turn' as const,
      content: [{ type: 'text' as const, text: 'ok' }],
      toolCalls: [] as Array<{ id: string; name: string; input: Record<string, unknown> }>,
      usage: null,
    };
    const merged = mergeToolCallsFromFinalMessage(event, {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a.ts' } }],
    });
    expect(merged.stopReason).toBe('tool_use');
    expect(merged.toolCalls).toEqual([{ id: 't1', name: 'Read', input: { path: 'a.ts' } }]);
  });
});
