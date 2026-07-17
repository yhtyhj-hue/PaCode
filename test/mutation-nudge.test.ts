/**
 * Mutation nudge: engineering intents must Edit/Write, not only Read
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueryEngine } from '../src/agent/engine.js';
import { PermissionMode } from '../src/pkg/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { createMockAnthropicClient, textEndTurnScenario, toolUseScenario } from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

describe('QueryEngine mutation nudge', () => {
  let workDir: string;
  beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), 'mut-nudge-')); });
  afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });
  it('nudges Edit/Write after Read-only turn on fix intent', async () => {
    const client = createMockAnthropicClient([
      toolUseScenario('r1', 'Read', { path: 'src/store.js' }),
      textEndTurnScenario('looks fine'),
      toolUseScenario('w1', 'Write', { path: 'src/store.js', content: "export function getUser() { return { name: 'Ada', age: 36 }; }\n" }),
      textEndTurnScenario('fixed'),
    ]);
    const registry = new ToolRegistry();
    registry.register({ name: 'Read', description: 'read', inputSchema: { type: 'object', properties: {} }, concurrencySafe: true, permissionMode: PermissionMode.DEFAULT, execute: async () => ({ toolCallId: '', content: 'ok', isError: false }) });
    registry.register({ name: 'Write', description: 'write', inputSchema: { type: 'object', properties: {} }, concurrencySafe: false, permissionMode: PermissionMode.DEFAULT, execute: async () => ({ toolCallId: '', content: 'ok', isError: false }) });
    const engine = new QueryEngine({ anthropicClient: client, toolRegistry: registry, contextAssembler: stubAssembler(), compactionPipeline: passthroughCompaction(), prefetch: { enabled: false }, workingDirectory: workDir, permissionPrompt: async () => true });
    const state = { sessionId: 'mut-nudge', messages: [], toolCallHistory: [], maxOutputTokensRecoveryCount: 0, mode: PermissionMode.BYPASS, hooks: { hooks: {} }, compactionHistory: [] } as never;
    const events: string[] = [];
    for await (const e of engine.query({ message: '修好跨模块契约不一致，使 verify.mjs 通过' }, state)) {
      if (e.type === 'tool_use' && e.tool) events.push(`tool:${e.tool.name}`);
      if (e.type === 'message_stop') events.push('stop');
    }
    expect(events.filter((x) => x === 'tool:Read').length).toBeGreaterThanOrEqual(1);
    expect(events.filter((x) => x === 'tool:Write').length).toBeGreaterThanOrEqual(1);
    expect(events).toContain('stop');
  });
});
