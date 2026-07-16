import type { SubagentReport } from '../../agent/subagent.js';

export type TrackedTaskStatus = 'running' | 'done' | 'error' | 'stopped';

export interface TrackedTask {
  id: string;
  description: string;
  subagentType: string;
  status: TrackedTaskStatus;
  startedAt: number;
  endedAt?: number;
  background: boolean;
  report?: SubagentReport;
  output?: string;
  error?: string;
}

export interface TaskListItem {
  id: string;
  description: string;
  subagentType: string;
  status: TrackedTaskStatus;
  startedAt: number;
  endedAt?: number;
  background: boolean;
}
