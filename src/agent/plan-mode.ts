/**
 * Plan Mode — draft/approve/execute with step-by-step engine drive (I4)
 */

import { PermissionMode } from '../pkg/types.js';

export type PlanStepStatus = 'pending' | 'running' | 'done';

export interface Plan {
  id: string;
  title: string;
  description: string;
  steps: PlanStep[];
  createdAt: number;
  status: 'draft' | 'approved' | 'rejected' | 'executing' | 'completed';
  currentStepIndex: number;
}

export interface PlanStep {
  index: number;
  action: string;
  tool?: string;
  description: string;
  estimatedRisk: 'low' | 'medium' | 'high';
  status: PlanStepStatus;
}

export class PlanModeManager {
  private plans: Map<string, Plan> = new Map();
  private activePlanId: string | null = null;

  createPlan(title: string, description: string, steps: Omit<PlanStep, 'status'>[]): Plan {
    const plan: Plan = {
      id: `plan-${Date.now()}`,
      title,
      description,
      steps: steps.map((s, i) => ({
        ...s,
        index: s.index ?? i,
        status: 'pending' as const,
      })),
      createdAt: Date.now(),
      status: 'draft',
      currentStepIndex: 0,
    };
    this.plans.set(plan.id, plan);
    this.activePlanId = plan.id;
    return plan;
  }

  getActive(): Plan | null {
    return this.activePlanId ? (this.plans.get(this.activePlanId) ?? null) : null;
  }

  get(id: string): Plan | null {
    return this.plans.get(id) ?? null;
  }

  list(): Plan[] {
    return Array.from(this.plans.values());
  }

  approve(id: string): void {
    const plan = this.plans.get(id);
    if (plan) plan.status = 'approved';
  }

  reject(id: string): void {
    const plan = this.plans.get(id);
    if (plan) plan.status = 'rejected';
  }

  startExecution(id: string): Plan | null {
    const plan = this.plans.get(id);
    if (!plan || plan.status !== 'approved') return null;
    plan.status = 'executing';
    plan.currentStepIndex = 0;
    for (const step of plan.steps) step.status = 'pending';
    return plan;
  }

  complete(id: string): void {
    const plan = this.plans.get(id);
    if (plan) {
      plan.status = 'completed';
      for (const step of plan.steps) {
        if (step.status !== 'done') step.status = 'done';
      }
    }
  }

  getCurrentStep(plan: Plan = this.getActive()!): PlanStep | null {
    if (!plan || plan.status !== 'executing') return null;
    return plan.steps[plan.currentStepIndex] ?? null;
  }

  beginCurrentStep(planId?: string): PlanStep | null {
    const plan = planId ? this.plans.get(planId) : this.getActive();
    if (!plan || plan.status !== 'executing') return null;
    const step = plan.steps[plan.currentStepIndex];
    if (!step) return null;
    if (step.status === 'pending') step.status = 'running';
    return step;
  }

  advanceAfterTurn(planId?: string): { completed: boolean; next: PlanStep | null; plan: Plan | null } {
    const plan = planId ? this.plans.get(planId) : this.getActive();
    if (!plan || plan.status !== 'executing') {
      return { completed: false, next: null, plan: plan ?? null };
    }
    const cur = plan.steps[plan.currentStepIndex];
    if (cur) cur.status = 'done';
    plan.currentStepIndex += 1;
    if (plan.currentStepIndex >= plan.steps.length) {
      plan.status = 'completed';
      return { completed: true, next: null, plan };
    }
    const next = plan.steps[plan.currentStepIndex]!;
    next.status = 'running';
    return { completed: false, next, plan };
  }

  formatPlanMessage(plan: Plan): string {
    const lines: string[] = [];
    lines.push(`# ${plan.title}`);
    lines.push('');
    lines.push(plan.description);
    lines.push('');
    lines.push('## Steps');
    lines.push('');
    for (const step of plan.steps) {
      const riskIcon =
        step.estimatedRisk === 'high' ? '🔴' : step.estimatedRisk === 'medium' ? '🟡' : '🟢';
      const st = step.status ? ` [${step.status}]` : '';
      lines.push(
        `${step.index + 1}. ${riskIcon} **${step.action}**${step.tool ? ` _(${step.tool})_` : ''}${st}`
      );
      lines.push(`   ${step.description}`);
    }
    return lines.join('\n');
  }

  static canExecute(mode: PermissionMode): boolean {
    return mode !== PermissionMode.PLAN;
  }
}

export function formatPlanStepDriveMessage(plan: Plan, step: PlanStep): string {
  const toolHint = step.tool
    ? `Prefer the ${step.tool} tool when applicable.`
    : 'Use the appropriate tools.';
  return [
    `[Plan execution] Plan ${plan.id}: "${plan.title}"`,
    `Execute ONLY step ${step.index + 1}/${plan.steps.length}: ${step.action}`,
    step.description,
    toolHint,
    'When this step is done, stop (end_turn). Do not skip ahead to later steps.',
  ].join('\n');
}

export function formatPlanExecutionKickoff(plan: Plan): string {
  return [
    `Execute the approved plan ${plan.id} ("${plan.title}") step by step.`,
    'The harness will inject each step; complete the current step then end_turn.',
    `Total steps: ${plan.steps.length}.`,
  ].join('\n');
}

let instance: PlanModeManager | null = null;
export function getPlanManager(): PlanModeManager {
  if (!instance) instance = new PlanModeManager();
  return instance;
}

export function resetPlanManager(): void {
  instance = null;
}
