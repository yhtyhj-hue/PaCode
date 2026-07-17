/**
 * I4: plan execution report (done/failed audit)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryEngine } from '../src/agent/engine.js';
import { PermissionMode } from '../src/pkg/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import {
  getPlanManager,
  resetPlanManager,
  buildPlanExecutionReport,
  formatPlanExecutionReport,
  formatPlanExecutionKickoff,
  MAX_PLAN_STEP_RETRIES,
} from '../src/agent/plan-mode.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
} from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

beforeEach(() => resetPlanManager());
afterEach(() => resetPlanManager());

describe('I4 plan execution report', () => {
  it('buildPlanExecutionReport counts done and failed', () => {
    const pm = getPlanManager();
    const plan = pm.createPlan('R', 'd', [
      { index: 0, action: 'a', description: 'A', estimatedRisk: 'low' },
      { index: 1, action: 'b', tool: 'Read', description: 'B', estimatedRisk: 'low' },
    ]);
    pm.approve(plan.id);
    pm.startExecution(plan.id);
    pm.beginCurrentStep(plan.id);
    pm.advanceAfterTurn(plan.id);
    pm.skipCurrentStep(plan.id, 'no tool use after retries');
    const report = buildPlanExecutionReport(plan);
    expect(report.done).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.steps[1]?.failReason).toContain('no tool use');
    const text = formatPlanExecutionReport(plan);
    expect(text).toContain('HAS_FAILURES');
    expect(text).toContain('✗');
    expect(text).toContain('✓');
  });

  it('complete() preserves failed steps', () => {
    const pm = getPlanManager();
    const plan = pm.createPlan('R', 'd', [
      { index: 0, action: 'a', description: 'A', estimatedRisk: 'low' },
      { index: 1, action: 'b', description: 'B', estimatedRisk: 'low' },
    ]);
    plan.steps[0]!.status = 'failed';
    plan.steps[0]!.failReason = 'x';
    plan.steps[1]!.status = 'pending';
    pm.complete(plan.id);
    expect(plan.steps[0]?.status).toBe('failed');
    expect(plan.steps[1]?.status).toBe('done');
  });

  it('engine emits report text when plan finishes with skips', async () => {
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
      sessionId: 'report',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.ACCEPT_EDITS,
      hooks: { hooks: {} },
      compactionHistory: [],
    } as never;

    let reportText = '';
    for await (const e of engine.query(
      { message: formatPlanExecutionKickoff(plan), mode: PermissionMode.ACCEPT_EDITS },
      state
    )) {
      if (e.type === 'content_block_delta' && e.delta?.text?.includes('[Plan report]')) {
        reportText += e.delta.text;
      }
    }
    expect(reportText).toContain('[Plan report]');
    expect(reportText).toContain('HAS_FAILURES');
    expect(reportText).toMatch(/failed/);
    expect(getPlanManager().getActive()?.status).toBe('completed');
  });
});
