/**
 * PostToolUse / Stop hook stdout 决策
 */

import { describe, it, expect, vi } from 'vitest';
import { HookRegistry } from '../src/hooks/registry.js';
import { runStopHooks } from '../src/hooks/loader.js';
import {
  applyPostToolUseDecision,
  parsePostToolUseDecision,
  parseStopHookDecision,
} from '../src/hooks/hook-decision.js';
import { HookType, PermissionMode, type SessionState } from '../src/pkg/types.js';
import { QueryEngine } from '../src/agent/engine.js';
import { ToolRegistry } from '../src/tools/registry.js';
import {
  createMockAnthropicClient,
  toolUseScenario,
  textEndTurnScenario,
} from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

describe('hook-decision parsers', () => {
  it('parses PostToolUse block / modify / allow', () => {
    expect(parsePostToolUseDecision('')).toEqual({ kind: 'allow' });
    expect(parsePostToolUseDecision('{"decision":"block","reason":"nope"}')).toEqual({
      kind: 'block',
      reason: 'nope',
    });
    const mod = parsePostToolUseDecision(
      '{"decision":"modify","content":[{"type":"text","text":"rewritten"}],"isError":false}'
    );
    expect(mod.kind).toBe('modify');
    if (mod.kind === 'modify') {
      expect(mod.result.content[0]).toMatchObject({ type: 'text', text: 'rewritten' });
    }
  });

  it('applyPostToolUseDecision respects exit 2 and block JSON', () => {
    const base = { content: [{ type: 'text' as const, text: 'ok' }] };
    const blocked = applyPostToolUseDecision(base, '', 2, 'h');
    expect(blocked.isError).toBe(true);
    const jsonBlock = applyPostToolUseDecision(
      base,
      '{"decision":"block","reason":"redacted"}',
      0,
      'h'
    );
    expect(jsonBlock.isError).toBe(true);
    expect(String(jsonBlock.content[0] && 'text' in jsonBlock.content[0] ? jsonBlock.content[0].text : '')).toBe(
      'redacted'
    );
  });

  it('parses Stop continue / stop', () => {
    expect(parseStopHookDecision('')).toEqual({ kind: 'continue' });
    expect(parseStopHookDecision('{"decision":"stop","reason":"budget"}')).toEqual({
      kind: 'stop',
      reason: 'budget',
    });
  });
});

describe('PostToolUse stdout in QueryEngine', () => {
  it('rewrites tool_result when hook returns modify JSON', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'Read',
      description: 'r',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.BYPASS,
      async execute() {
        return { content: [{ type: 'text' as const, text: 'raw' }] };
      },
    });
    const hooks = new HookRegistry();
    hooks.register({
      type: HookType.POST_TOOL_USE,
      name: 'rewrite',
      command: [
        'node',
        '-e',
        `process.stdout.write(JSON.stringify({decision:'modify',content:[{type:'text',text:'from-hook'}],isError:false}))`,
      ],
    });
    const client = createMockAnthropicClient([
      toolUseScenario('t1', 'Read', { path: 'a.ts' }),
      textEndTurnScenario('done'),
    ]);
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      hookRegistry: hooks,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      prefetch: { enabled: false },
    });
    const state = {
      sessionId: 'post-hook',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.BYPASS,
      hooks: { hooks: {} },
      compactionHistory: [],
    };
    const events = [];
    for await (const e of engine.query({ message: 'read a.ts' }, state as never)) {
      events.push(e);
    }
    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults.length).toBeGreaterThan(0);
    const text = toolResults[0]?.result?.content?.[0];
    expect(text && 'text' in text ? text.text : '').toBe('from-hook');
  });

  it('blocks tool_result when hook returns block JSON', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'Read',
      description: 'r',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.BYPASS,
      async execute() {
        return { content: [{ type: 'text' as const, text: 'raw' }] };
      },
    });
    const hooks = new HookRegistry();
    hooks.register({
      type: HookType.POST_TOOL_USE,
      name: 'blocker',
      command: [
        'node',
        '-e',
        `process.stdout.write(JSON.stringify({decision:'block',reason:'scrubbed'}))`,
      ],
    });
    const client = createMockAnthropicClient([
      toolUseScenario('t2', 'Read', { path: 'b.ts' }),
      textEndTurnScenario('done'),
    ]);
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      hookRegistry: hooks,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      prefetch: { enabled: false },
    });
    const state = {
      sessionId: 'post-block',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.BYPASS,
      hooks: { hooks: {} },
      compactionHistory: [],
    };
    const events = [];
    for await (const e of engine.query({ message: 'read b.ts' }, state as never)) {
      events.push(e);
    }
    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults[0]?.result?.isError).toBe(true);
    const text = toolResults[0]?.result?.content?.[0];
    expect(text && 'text' in text ? text.text : '').toBe('scrubbed');
  });
});

describe('Stop hook stdout', () => {
  it('runStopHooks returns stopped when stdout says stop', async () => {
    const hooks = new HookRegistry();
    vi.spyOn(hooks, 'execute').mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ decision: 'stop', reason: 'quota' }),
      stderr: '',
    });
    hooks.register({
      type: HookType.STOP,
      name: 'stopper',
      command: 'echo',
    });
    const result = await runStopHooks(hooks, {
      sessionId: 's',
      mode: PermissionMode.DEFAULT,
    } as SessionState);
    expect(result.stopped).toBe(true);
    expect(result.reason).toBe('quota');
  });
});
