/**
 * I3: QueryEngine end_turn after Edit triggers reflection and continues loop
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueryEngine } from '../src/agent/engine.js';
import { PermissionMode } from '../src/pkg/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { createMockAnthropicClient, textEndTurnScenario, toolUseScenario } from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'i3-eng-'));
  writeFileSync(join(workDir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }));
});
afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });

describe('I3 reflection in QueryEngine loop', () => {
  it('injects verifier failure and continues after Edit', async () => {
    const client = createMockAnthropicClient([
      toolUseScenario('e1', 'Edit', { path: 'a.ts', old_string: 'a', new_string: 'b' }),
      textEndTurnScenario('I edited the file'),
      textEndTurnScenario('fixed after reflection'),
    ]);
    const registry = new ToolRegistry();
    registry.register({
      name: 'Edit', description: 'edit', inputSchema: { type: 'object', properties: {} },
      concurrencySafe: false, permissionMode: PermissionMode.DEFAULT,
      execute: async () => ({ toolCallId: '', content: 'edited', isError: false }),
    });
    const engine = new QueryEngine({
      anthropicClient: client, toolRegistry: registry,
      contextAssembler: stubAssembler(), compactionPipeline: passthroughCompaction(),
      prefetch: { enabled: false }, workingDirectory: workDir,
    });
    const state = {
      sessionId: 'i3-loop', messages: [], toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0, mode: PermissionMode.BYPASS,
      hooks: { hooks: {} }, compactionHistory: [],
    } as never;
    let stops = 0;
    for await (const e of engine.query({ message: '修好 bug 使 verify 通过' }, state)) {
      if (e.type === 'message_stop') stops++;
    }
    expect(stops).toBe(1);
    const userTexts = state.messages
      .filter((m: { role: string }) => m.role === 'user')
      .map((m: { content: unknown }) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      .join('\n');
    expect(userTexts).toMatch(/test|verifier|failed|npm/i);
  });
});
