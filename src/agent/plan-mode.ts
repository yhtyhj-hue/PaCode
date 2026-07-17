/**
 * Plan Mode — draft/approve/execute with step-by-step engine drive (I4)
 */

import { PermissionMode } from '../pkg/types.js';

export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed';

/** 单步工具失败 / 无工具后的有界重试 */
export const MAX_PLAN_STEP_RETRIES = 2;

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
  status?: PlanStepStatus;
  /** skip/fail 原因（可审计） */
  failReason?: string;
}

export interface PlanExecutionReport {
  planId: string;
  title: string;
  status: Plan['status'];
  total: number;
  done: number;
  failed: number;
  pending: number;
  running: number;
  ok: boolean;
  steps: Array<{
    index: number;
    action: string;
    status: PlanStepStatus;
    tool?: string;
    failReason?: string;
  }>;
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
        // 保留 failed；仅收尾 pending/running
        if (step.status === 'pending' || step.status === 'running' || !step.status) {
          step.status = 'done';
        }
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

  /** 当前步失败并跳过（计入 failed）；返回下一步或 completed */
  skipCurrentStep(
    planId: string | undefined,
    reason: string
  ): { completed: boolean; next: PlanStep | null; plan: Plan | null; reason: string } {
    const plan = planId ? this.plans.get(planId) : this.getActive();
    if (!plan || plan.status !== 'executing') {
      return { completed: false, next: null, plan: plan ?? null, reason };
    }
    const cur = plan.steps[plan.currentStepIndex];
    if (cur) {
      cur.status = 'failed';
      cur.failReason = reason;
    }
    plan.currentStepIndex += 1;
    if (plan.currentStepIndex >= plan.steps.length) {
      plan.status = 'completed';
      return { completed: true, next: null, plan, reason };
    }
    const next = plan.steps[plan.currentStepIndex]!;
    next.status = 'running';
    return { completed: false, next, plan, reason };
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

/** 确定性执行报告：done/failed/pending 可审计 */
export function buildPlanExecutionReport(plan: Plan): PlanExecutionReport {
  let done = 0;
  let failed = 0;
  let pending = 0;
  let running = 0;
  const steps: PlanExecutionReport['steps'] = [];
  for (const step of plan.steps) {
    const status: PlanStepStatus = step.status ?? 'pending';
    if (status === 'done') done += 1;
    else if (status === 'failed') failed += 1;
    else if (status === 'running') running += 1;
    else pending += 1;
    steps.push({
      index: step.index,
      action: step.action,
      status,
      tool: step.tool,
      failReason: step.failReason,
    });
  }
  return {
    planId: plan.id,
    title: plan.title,
    status: plan.status,
    total: plan.steps.length,
    done,
    failed,
    pending,
    running,
    ok: failed === 0 && pending === 0 && running === 0,
    steps,
  };
}

export function formatPlanExecutionReport(plan: Plan): string {
  const r = buildPlanExecutionReport(plan);
  const lines: string[] = [
    `[Plan report] ${r.planId} "${r.title}" (${r.status})`,
    `summary: ${r.done} done / ${r.failed} failed / ${r.pending} pending / ${r.running} running (total ${r.total})`,
    r.ok ? 'result: OK' : 'result: HAS_FAILURES',
    'steps:',
  ];
  for (const step of r.steps) {
    const mark =
      step.status === 'done' ? '✓' : step.status === 'failed' ? '✗' : step.status === 'running' ? '…' : '·';
    const tool = step.tool ? ` (${step.tool})` : '';
    const why = step.failReason ? ` — ${step.failReason}` : '';
    lines.push(`  ${mark} ${step.index + 1}. ${step.action}${tool} [${step.status}]${why}`);
  }
  return lines.join('\n');
}

let instance: PlanModeManager | null = null;
export function getPlanManager(): PlanModeManager {
  if (!instance) instance = new PlanModeManager();
  return instance;
}

export function resetPlanManager(): void {
  instance = null;
}
