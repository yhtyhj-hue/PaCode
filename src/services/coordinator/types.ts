import type { SubagentReport } from '../../agent/subagent.js';

/** J3 强契约版本 — 无效/缺失则工具报错 */
export const COORDINATOR_CONTRACT = 'j3/v1' as const;

export type CoordinatorRole = 'lead' | 'worker' | 'explore';

export const COORDINATOR_ROLES: readonly CoordinatorRole[] = [
  'lead',
  'worker',
  'explore',
] as const;

export interface CoordinatorAssignment {
  contract: typeof COORDINATOR_CONTRACT;
  assignment_id: string;
  team_id: string;
  task_id: string;
  from: string;
  to: string;
  description: string;
  subagent_type: string;
  created_at: number;
}

export interface CoordinatorCollectResult {
  contract: typeof COORDINATOR_CONTRACT;
  team_id: string;
  done: string[];
  pending: string[];
  failed: string[];
  reports: Array<{
    assignment_id: string;
    task_id: string;
    to: string;
    status: string;
    report: SubagentReport;
  }>;
}

export interface CoordinatorPollItem {
  assignment_id: string;
  task_id: string;
  to: string;
  description: string;
  status: string;
  background: boolean;
}
