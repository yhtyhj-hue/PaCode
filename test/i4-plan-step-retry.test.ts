/**
 * I4: plan step bounded retry then skip
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryEngine } from '../src/agent/engine.js';
import { PermissionMode } from '../src/pkg/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerPlanModeTools } from '../src/tools/plan-mode.js';
import {
  getPlanManager,
  resetPlanManager,
  MAX_PLAN_STEP_RETRIES,
} from '../src/agent/plan-mode.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
  toolUseScenario,
} from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

beforeEach(() => resetPlanManager());
afterEach(() => resetPlanManager());

describe('I4 plan step retry', () => {
  it('exposes MAX_PLAN_STEP_RETRIES bound', () => {
    expect(MAX_PLAN_STEP_RETRIES).toBe(2);
  });

  it('skipCurrentStep marks failed and advances', () => {
    const pm = getPlanManager();
    const plan = pm.createPlan('T', 'd', [
      { index: 0, action: 'a', tool: 'Read', description: 'A', estimatedRisk: 'low' },
      { index: 1, action: 'b', description: 'B', estimatedRisk: 'low' },
    ]);
    pm.approve(plan.id);
    pm.startExecution(plan.id);
    pm.beginCurrentStep(plan.id);
    const r = pm.skipCurrentStep(plan.id, 'no tools');
    expect(plan.steps[0]?.status).toBe('failed');
    expect(r.next?.action).toBe('b');
  });

  it('retries tool-required step then skips to next', async () => {
    // ExitPlanMode -> many end_turns without tools for step0 (Read required)
    // After nudge + MAX retries, skip to step1 (no tool) -> complete
    const scenarios = [
      toolUseScenario('x1', 'ExitPlanMode', {}),
      textEndTurnScenario('noop0'), // first attempt step0
      textEndTurnScenario('noop-nudge'), // after tool nudge
    ];
    // retries
    for (let i = 0; i < MAX_PLAN_STEP_RETRIES; i++) {
      scenarios.push(textEndTurnScenario(`retry${i}`));
      scenarios.push(textEndTurnScenario(`retry${i}-nudge`));
    }
    scenarios.push(textEndTurnScenario('step1 done')); // after skip

    const pm = getPlanManager();
    pm.createPlan('Retry plan', 'd', [
      { index: 0, action: 'read', tool: 'Read', description: 'must read', estimatedRisk: 'low' },
      { index: 1, action: 'done', description: 'finish', estimatedRisk: 'low' },
    ]);
    pm.approve(pm.getActive()!.id);
    pm.startExecution(pm.getActive()!.id);

    const registry = new ToolRegistry();
    registerPlanModeTools(registry);
    registry.register({
      name: 'Read', description: 'read', inputSchema: { type: 'object', properties: {} },
      concurrencySafe: true, permissionMode: PermissionMode.DEFAULT,
      execute: async () => ({ toolCallId: '', content: 'ok', isError: false }),
    });
    const engine = new QueryEngine({
      anthropicClient: createMockAnthropicClient(scenarios),
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      prefetch: { enabled: false },
      permissionPrompt: async () => true,
    });
    const state = {
      sessionId: 'retry', messages: [], toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0, mode: PermissionMode.PLAN,
      hooks: { hooks: {} }, compactionHistory: [],
    } as never;

    for await (const _ of engine.query({ message: 'execute', mode: PermissionMode.PLAN }, state)) {
      /* drain */
    }
    const plan = getPlanManager().getActive()!;
    expect(plan.steps[0]?.status).toBe('failed');
    expect(plan.status).toBe('completed');
  });
});
