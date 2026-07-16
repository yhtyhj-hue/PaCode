/**
 * J3: assignment 登记（Team 成员 ↔ Task）
 */

import type { CoordinatorAssignment } from './types.js';
import { COORDINATOR_CONTRACT } from './types.js';

const MAX_ASSIGNMENTS = 100;

export class CoordinatorStore {
  private byId = new Map<string, CoordinatorAssignment>();
  private byTeam = new Map<string, Set<string>>();
  private seq = 0;

  create(input: {
    teamId: string;
    taskId: string;
    from: string;
    to: string;
    description: string;
    subagentType: string;
  }): CoordinatorAssignment {
    this.seq += 1;
    const assignment: CoordinatorAssignment = {
      contract: COORDINATOR_CONTRACT,
      assignment_id: `asn_${Date.now().toString(36)}_${this.seq}`,
      team_id: input.teamId,
      task_id: input.taskId,
      from: input.from,
      to: input.to,
      description: input.description,
      subagent_type: input.subagentType,
      created_at: Date.now(),
    };
    this.byId.set(assignment.assignment_id, assignment);
    let set = this.byTeam.get(input.teamId);
    if (!set) {
      set = new Set();
      this.byTeam.set(input.teamId, set);
    }
    set.add(assignment.assignment_id);
    this.trim();
    return assignment;
  }

  get(assignmentId: string): CoordinatorAssignment | undefined {
    return this.byId.get(assignmentId);
  }

  listForTeam(teamId: string): CoordinatorAssignment[] {
    const ids = this.byTeam.get(teamId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.byId.get(id))
      .filter((a): a is CoordinatorAssignment => !!a)
      .sort((a, b) => b.created_at - a.created_at);
  }

  clear(): void {
    this.byId.clear();
    this.byTeam.clear();
    this.seq = 0;
  }

  private trim(): void {
    if (this.byId.size <= MAX_ASSIGNMENTS) return;
    const sorted = Array.from(this.byId.values()).sort(
      (a, b) => a.created_at - b.created_at
    );
    const drop = sorted.slice(0, this.byId.size - MAX_ASSIGNMENTS);
    for (const a of drop) {
      this.byId.delete(a.assignment_id);
      this.byTeam.get(a.team_id)?.delete(a.assignment_id);
    }
  }
}

let instance: CoordinatorStore | null = null;

export function getCoordinatorStore(): CoordinatorStore {
  if (!instance) instance = new CoordinatorStore();
  return instance;
}

export function resetCoordinatorStore(): void {
  instance = null;
}
