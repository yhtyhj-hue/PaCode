import { describe, it, expect, beforeEach } from 'vitest';
import { QueryEngine } from '../src/agent/engine.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { HookRegistry } from '../src/hooks/registry.js';
import {
  HookType,
  PermissionMode,
  SessionState,
  ToolDefinition,
} from '../src/pkg/types.js';

function createState(): SessionState {
  return {
    sessionId: 'test-session',
    messages: [],
    toolCallHistory: [],
    maxOutputTokensRecoveryCount: 0,
    mode: PermissionMode.DEFAULT,
    hooks: { hooks: {} },
    compactionHistory: [],
  };
}

describe('QueryEngine tool pipeline', () => {
  let registry: ToolRegistry;
  let hooks: HookRegistry;
  let engine: QueryEngine;
  let state: SessionState;

  beforeEach(() => {
    registry = new ToolRegistry();
    hooks = new HookRegistry();
    engine = new QueryEngine({
      apiKey: 'test-key',
      toolRegistry: registry,
      hookRegistry: hooks,
      permissionPrompt: async () => true,
    });
    state = createState();
  });

  it('executes registered tool', async () => {
    registry.register({
      name: 'Echo',
      description: 'echo',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.DEFAULT,
      async execute(input) {
        return { content: [{ type: 'text', text: String((input as { msg: string }).msg) }] };
      },
    });

    const result = await engine.executeToolCall(
      { id: 't1', name: 'Echo', input: { msg: 'hello' } },
      state
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toBe('hello');
  });

  it('blocks tool when PreToolUse hook exits with code 2', async () => {
    registry.register(createOkTool('BlockedTool'));

    hooks.register({
      name: 'block-bash',
      type: HookType.PRE_TOOL_USE,
      command: process.platform === 'win32' ? 'cmd /c exit 2' : 'sh -c "exit 2"',
      matcher: { tool: 'BlockedTool' },
    });

    const result = await engine.executeToolCall(
      { id: 't2', name: 'BlockedTool', input: {} },
      state
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('blocked by hook');
  });

  it('runs PostToolUse hook after successful execution', async () => {
    registry.register(createOkTool('RunTool'));

    hooks.register({
      name: 'post-echo',
      type: HookType.POST_TOOL_USE,
      command: process.platform === 'win32' ? 'cmd /c echo post' : 'echo post',
      matcher: { tool: 'RunTool' },
    });

    const result = await engine.executeToolCall(
      { id: 't3', name: 'RunTool', input: {} },
      state
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toBe('ok');
  });

  it('returns error for unknown tool', async () => {
    const result = await engine.executeToolCall(
      { id: 't4', name: 'Missing', input: {} },
      state
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Tool not found');
  });

  it('uses injected permissionPrompt callback', async () => {
    registry.register(createOkTool('ConfirmTool'));

    const deniedEngine = new QueryEngine({
      apiKey: 'test-key',
      toolRegistry: registry,
      hookRegistry: hooks,
      permissionPrompt: async () => false,
    });

    const promptResult = await deniedEngine['permissionPrompt']({
      id: 'x',
      name: 'ConfirmTool',
      input: {},
    });
    expect(promptResult).toBe(false);
  });

  it('denies permission in non-TTY by default', async () => {
    const tty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    const freshEngine = new QueryEngine({ apiKey: 'test-key' });
    const allowed = await freshEngine['defaultPermissionPrompt']({
      id: 'p1',
      name: 'Bash',
      input: { command: 'echo hi' },
    });

    Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true });
    expect(allowed).toBe(false);
  });
});

function createOkTool(name: string): ToolDefinition {
  return {
    name,
    description: 'ok tool',
    inputSchema: {},
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute() {
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
}
