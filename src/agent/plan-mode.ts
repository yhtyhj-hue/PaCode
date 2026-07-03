/**
 * Plan Mode
 *
 * When in plan mode, the agent generates plans but doesn't execute.
 * Mirrors Claude Code's /plan and plan mode behavior.
 */

import { PermissionMode } from '../pkg/types.js';

export interface Plan {
  id: string;
  title: string;
  description: string;
  steps: PlanStep[];
  createdAt: number;
  status: 'draft' | 'approved' | 'rejected' | 'executing' | 'completed';
}

export interface PlanStep {
  index: number;
  action: string;
  tool?: string;
  description: string;
  estimatedRisk: 'low' | 'medium' | 'high';
}

export class PlanModeManager {
  private plans: Map<string, Plan> = new Map();
  private activePlanId: string | null = null;

  createPlan(title: string, description: string, steps: PlanStep[]): Plan {
    const plan: Plan = {
      id: `plan-${Date.now()}`,
      title,
      description,
      steps,
      createdAt: Date.now(),
      status: 'draft',
    };
    this.plans.set(plan.id, plan);
    this.activePlanId = plan.id;
    return plan;
  }

  getActive(): Plan | null {
    return this.activePlanId ? this.plans.get(this.activePlanId) ?? null : null;
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
        step.estimatedRisk === 'high' ? '🔴' :
        step.estimatedRisk === 'medium' ? '🟡' : '🟢';
      lines.push(`${step.index + 1}. ${riskIcon} **${step.action}**${step.tool ? ` _(${step.tool})_` : ''}`);
      lines.push(`   ${step.description}`);
    }
    return lines.join('\n');
  }

  static canExecute(mode: PermissionMode): boolean {
    return mode !== PermissionMode.PLAN;
  }
}

let instance: PlanModeManager | null = null;
export function getPlanManager(): PlanModeManager {
  if (!instance) instance = new PlanModeManager();
  return instance;
}