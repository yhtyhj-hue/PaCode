/**
 * H1 prefetch config + H2 session approval memory
 */

import { describe, it, expect, vi } from 'vitest';
import {
  shouldRunPrefetch,
  parsePrefetchEnv,
  normalizePrefetchIntents,
} from '../src/agent/prefetch-config.js';
import {
  approvalKey,
  hasSessionApproval,
  rememberSessionApproval,
  clearSessionApprovals,
} from '../src/permission/session-memory.js';
import { PermissionMode } from '../src/pkg/types.js';
import { authorizePrefetchTool } from '../src/permission/prefetch-gate.js';
import { PermissionSystem } from '../src/permission/system.js';
import { QueryEngine } from '../src/agent/engine.js';
import { ToolRegistry } from '../src/tools/registry.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
  toolUseScenario,
} from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

describe('prefetch-config (H1)', () => {
  it('parsePrefetchEnv understands off/on', () => {
    expect(parsePrefetchEnv({ PACODE_PREFETCH: '0' })).toBe(false);
    expect(parsePrefetchEnv({ PACODE_PREFETCH: 'false' })).toBe(false);
    expect(parsePrefetchEnv({ PACODE_PREFETCH: '1' })).toBe(true);
    expect(parsePrefetchEnv({})).toBeUndefined();
  });

  it('shouldRunPrefetch respects enabled and intent whitelist', () => {
    expect(shouldRunPrefetch({ enabled: false }, 'inspect_project', {})).toBe(false);
    expect(shouldRunPrefetch({ enabled: true }, 'inspect_project', {})).toBe(true);
    expect(
      shouldRunPrefetch({ enabled: true, intents: ['run_tests'] }, 'inspect_project', {})
    ).toBe(false);
    expect(
      shouldRunPrefetch({ enabled: true, intents: ['inspect_project'] }, 'inspect_project', {})
    ).toBe(true);
    expect(shouldRunPrefetch({ enabled: true }, 'inspect_project', { PACODE_PREFETCH: '0' })).toBe(
      false
    );
  });

  it('normalizePrefetchIntents drops unknown', () => {
    expect(normalizePrefetchIntents(['inspect_project', 'nope'])).toEqual(['inspect_project']);
  });
});

describe('session-memory (H2)', () => {
  it('approvalKey fingerprints package-manager subcommands', () => {
    expect(approvalKey({ id: '1', name: 'Read', input: { path: 'a' } })).toBe('Read');
    expect(
      approvalKey({ id: '1', name: 'Bash', input: { command: 'npm test -- --run' } })
    ).toBe('Bash:npm:test');
    expect(
      approvalKey({ id: '1', name: 'Bash', input: { command: 'npm run build' } })
    ).toBe('Bash:npm:run:build');
    expect(
      approvalKey({ id: '1', name: 'Bash', input: { command: 'git push origin main' } })
    ).toBe('Bash:git:push');
  });

  it('remembers and matches session approvals narrowly', () => {
    const state = {
      sessionId: 's',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
      sessionApprovals: [] as string[],
    };
    const bash = { id: '1', name: 'Bash', input: { command: 'npm test' } };
    expect(hasSessionApproval(state, bash)).toBe(false);
    rememberSessionApproval(state, bash);
    expect(hasSessionApproval(state, bash)).toBe(true);
    // npm test 不得批准 npm run build / npm publish
    expect(
      hasSessionApproval(state, { id: '2', name: 'Bash', input: { command: 'npm run build' } })
    ).toBe(false);
    expect(
      hasSessionApproval(state, { id: '2b', name: 'Bash', input: { command: 'npm publish' } })
    ).toBe(false);
    expect(
      hasSessionApproval(state, { id: '3', name: 'Bash', input: { command: 'git status' } })
    ).toBe(false);
    clearSessionApprovals(state);
    expect(hasSessionApproval(state, bash)).toBe(false);
  });
});

describe('prefetch gate + session memory', () => {
  it('skips prompt when session already approved Bash:npm:test', async () => {
    const prompt = vi.fn().mockResolvedValue(true);
    const tool = { id: '1', name: 'Bash', input: { command: 'npm test' } };
    const state = {
      sessionId: 's',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
      sessionApprovals: ['Bash:npm:test'],
    };
    const blocked = await authorizePrefetchTool(tool, {
      permissionSystem: new PermissionSystem(),
      mode: PermissionMode.DEFAULT,
      state: state as never,
      prompt,
      batchConfirm: { promise: null, tools: [tool] },
    });
    expect(blocked).toBeNull();
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('QueryEngine prefetch disabled (H1)', () => {
  it('does not emit prefetch_complete when prefetch.enabled=false', async () => {
    const registry = new ToolRegistry();
    for (const name of ['Read', 'Bash', 'Glob']) {
      registry.register({
        name,
        description: name,
        inputSchema: {},
        concurrencySafe: true,
        permissionMode: PermissionMode.DEFAULT,
        async execute() {
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      });
    }

    // 预取关闭后走模型 tool loop：mock 须真调工具，否则 TOOL_REQUIRED
    const client = createMockAnthropicClient([
      toolUseScenario('tu_1', 'Read', { path: 'package.json' }),
      textEndTurnScenario('done'),
    ]);
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      permissionPrompt: async () => true,
      prefetch: { enabled: false },
    });

    const state = {
      sessionId: 'no-prefetch',
      messages: [] as Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>,
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.BYPASS,
      hooks: { hooks: {} },
      compactionHistory: [],
      sessionApprovals: [],
    };

    const events: string[] = [];
    for await (const e of engine.query({ message: '检查这个项目' }, state)) {
      events.push(e.type);
    }

    expect(events).not.toContain('prefetch_complete');
    expect(events).not.toContain('agents_running');
    expect(events).toContain('tool_use');
    expect(events).toContain('message_stop');
  });
});
