/**
 * I4: plan step bounded retry then skip
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryEngine } from '../src/agent/engine.js';
import { PermissionMode } from '../src/pkg/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import {
  getPlanManager,
  resetPlanManager,
  MAX_PLAN_STEP_RETRIES,
  formatPlanExecutionKickoff,
} from '../src/agent/plan-mode.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
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
    const scenarios = [
      textEndTurnScenario('noop0'),
      textEndTurnScenario('noop-nudge'),
    ];
    for (let i = 0; i < MAX_PLAN_STEP_RETRIES; i++) {
      scenarios.push(textEndTurnScenario(`retry${i}`));
      scenarios.push(textEndTurnScenario(`retry${i}-nudge`));
    }
    scenarios.push(textEndTurnScenario('step1 done'));

    const pm = getPlanManager();
    const plan = pm.createPlan('Retry plan', 'd', [
      { index: 0, action: 'read', tool: 'Read', description: 'must read', estimatedRisk: 'low' },
      { index: 1, action: 'done', description: 'finish', estimatedRisk: 'low' },
    ]);
    pm.approve(plan.id);
    pm.startExecution(plan.id);

    const engine = new QueryEngine({
      anthropicClient: createMockAnthropicClient(scenarios),
      toolRegistry: new ToolRegistry(),
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      prefetch: { enabled: false },
      permissionPrompt: async () => true,
    });
    const state = {
      sessionId: 'retry',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.ACCEPT_EDITS,
      hooks: { hooks: {} },
      compactionHistory: [],
    } as never;

    for await (const _ of engine.query(
      { message: formatPlanExecutionKickoff(plan), mode: PermissionMode.ACCEPT_EDITS },
      state
    )) {
      /* drain */
    }
    const active = getPlanManager().getActive()!;
    expect(active.steps[0]?.status).toBe('failed');
    expect(active.status).toBe('completed');
  });
});
