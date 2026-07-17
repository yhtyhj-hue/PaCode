/**
 * I4: QueryEngine drives plan steps after ExitPlanMode
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryEngine } from '../src/agent/engine.js';
import { PermissionMode } from '../src/pkg/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerPlanModeTools } from '../src/tools/plan-mode.js';
import { getPlanManager, resetPlanManager, formatPlanStepDriveMessage } from '../src/agent/plan-mode.js';
import { createMockAnthropicClient, textEndTurnScenario, toolUseScenario } from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

beforeEach(() => resetPlanManager());
afterEach(() => resetPlanManager());

function makeEngine(client: ReturnType<typeof createMockAnthropicClient>) {
  const registry = new ToolRegistry();
  registerPlanModeTools(registry);
  registry.register({
    name: 'Read', description: 'read', inputSchema: { type: 'object', properties: {} },
    concurrencySafe: true, permissionMode: PermissionMode.DEFAULT,
    execute: async () => ({ toolCallId: '', content: 'file ok', isError: false }),
  });
  return new QueryEngine({
    anthropicClient: client, toolRegistry: registry,
    contextAssembler: stubAssembler(), compactionPipeline: passthroughCompaction(),
    prefetch: { enabled: false }, permissionPrompt: async () => true,
  });
}

describe('I4 plan step driver', () => {
  it('formatPlanStepDriveMessage names step and plan id', () => {
    const pm = getPlanManager();
    const plan = pm.createPlan('T', 'd', [
      { index: 0, action: 'read', tool: 'Read', description: 'open a.ts', estimatedRisk: 'low' },
    ]);
    expect(formatPlanStepDriveMessage(plan, plan.steps[0]!)).toContain('step 1/1');
  });

  it('advanceAfterTurn completes after last step', () => {
    const pm = getPlanManager();
    const plan = pm.createPlan('T', 'd', [
      { index: 0, action: 'a', description: 'A', estimatedRisk: 'low' },
      { index: 1, action: 'b', description: 'B', estimatedRisk: 'low' },
    ]);
    pm.approve(plan.id);
    pm.startExecution(plan.id);
    pm.beginCurrentStep(plan.id);
    expect(pm.advanceAfterTurn(plan.id).next?.action).toBe('b');
    expect(pm.advanceAfterTurn(plan.id).completed).toBe(true);
  });

  it('ExitPlanMode then engine drives all steps to completed', async () => {
    const client = createMockAnthropicClient([
      toolUseScenario('e1', 'EnterPlanMode', {
        title: 'Two steps',
        steps: [
          { action: 'scan', description: 'look around' },
          { action: 'read', tool: 'Read', description: 'read file' },
        ],
      }),
      toolUseScenario('x1', 'ExitPlanMode', {}),
      textEndTurnScenario('step1 done'),
      toolUseScenario('r1', 'Read', { path: 'a.ts' }),
      textEndTurnScenario('step2 done'),
    ]);
    const engine = makeEngine(client);
    const state = {
      sessionId: 'i4-plan', messages: [], toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0, mode: PermissionMode.PLAN,
      hooks: { hooks: {} }, compactionHistory: [],
    } as never;
    const events: string[] = [];
    for await (const e of engine.query({ message: 'plan the work', mode: PermissionMode.PLAN }, state)) {
      if (e.type === 'tool_use' && e.tool) events.push(`tool:${e.tool.name}`);
      if (e.type === 'content_block_delta' && e.delta?.text?.includes('completed')) events.push('plan-completed');
    }
    expect(events).toContain('tool:EnterPlanMode');
    expect(events).toContain('tool:ExitPlanMode');
    expect(events).toContain('tool:Read');
    expect(getPlanManager().getActive()?.status).toBe('completed');
    expect(state.mode).toBe(PermissionMode.ACCEPT_EDITS);
    expect(events).toContain('plan-completed');
  });
});
