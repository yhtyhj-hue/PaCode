/**
 * PlanModeManager tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PlanModeManager } from '../src/agent/plan-mode.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('PlanModeManager', () => {
  let manager: PlanModeManager;

  beforeEach(() => {
    manager = new PlanModeManager();
  });

  it('creates and retrieves active plan', () => {
    const plan = manager.createPlan('Test', 'desc', [
      { index: 0, action: 'Read', description: 'read files', estimatedRisk: 'low' },
    ]);
    expect(manager.getActive()?.id).toBe(plan.id);
    expect(plan.status).toBe('draft');
  });

  it('approve and startExecution workflow', () => {
    const plan = manager.createPlan('Exec', 'd', [
      { index: 0, action: 'Edit', description: 'edit', estimatedRisk: 'medium', tool: 'Edit' },
    ]);
    manager.approve(plan.id);
    expect(manager.getActive()?.status).toBe('approved');

    const executing = manager.startExecution(plan.id);
    expect(executing?.status).toBe('executing');
    expect(executing?.steps[0]?.status).toBe('pending');
    expect(executing?.currentStepIndex).toBe(0);
  });

  it('startExecution fails without approve', () => {
    const plan = manager.createPlan('Draft', 'd', []);
    expect(manager.startExecution(plan.id)).toBeNull();
  });

  it('formatPlanMessage includes steps and tools', () => {
    const plan = manager.createPlan('Fmt', 'description', [
      { index: 0, action: 'Scan', tool: 'Grep', description: 'find usages', estimatedRisk: 'low' },
    ]);
    const msg = manager.formatPlanMessage(plan);
    expect(msg).toContain('# Fmt');
    expect(msg).toContain('Grep');
    expect(msg).toContain('Scan');
  });

  it('canExecute blocks PLAN mode', () => {
    expect(PlanModeManager.canExecute(PermissionMode.PLAN)).toBe(false);
    expect(PlanModeManager.canExecute(PermissionMode.DEFAULT)).toBe(true);
  });
});
