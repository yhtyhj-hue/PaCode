/**
 * J3 Coordinator — 有限角色 + 固定契约调度（非第二套 agent loop）
 */

import {
  getSubagentManager,
  type SubagentRunOptions,
} from '../../agent/subagent.js';
import type { ToolRegistry } from '../../tools/registry.js';
import { getTaskStore } from '../task-registry/index.js';
import { getTeamStore } from '../team/index.js';
import { getCoordinatorStore } from './store.js';
import {
  COORDINATOR_CONTRACT,
  COORDINATOR_ROLES,
  type CoordinatorAssignment,
  type CoordinatorCollectResult,
  type CoordinatorPollItem,
  type CoordinatorRole,
} from './types.js';

export interface CoordinatorRunDeps {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  toolRegistry: ToolRegistry;
  /** 测试注入 */
  runOptions?: Partial<SubagentRunOptions>;
}

function isLeadRole(role: string): boolean {
  return role === 'lead';
}

function normalizeRole(role: string): CoordinatorRole | null {
  return (COORDINATOR_ROLES as readonly string[]).includes(role)
    ? (role as CoordinatorRole)
    : null;
}

function resolveSubagentType(member: {
  role: string;
  subagentType?: string;
}): string | null {
  if (member.subagentType) return member.subagentType;
  if (member.role === 'explore') return 'explore';
  return null;
}

/** 校验并解析 j3 契约信封 */
export function parseCoordinatorEnvelope(
  raw: string
): { ok: true; assignment: CoordinatorAssignment } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as Partial<CoordinatorAssignment>;
    if (parsed.contract !== COORDINATOR_CONTRACT) {
      return { ok: false, error: `Invalid contract (want ${COORDINATOR_CONTRACT})` };
    }
    if (!parsed.assignment_id || !parsed.task_id || !parsed.team_id) {
      return { ok: false, error: 'Incomplete CoordinatorAssignment envelope' };
    }
    return { ok: true, assignment: parsed as CoordinatorAssignment };
  } catch {
    return { ok: false, error: 'Envelope is not valid JSON' };
  }
}

type AssignInput = {
  teamId: string;
  from: string;
  to: string;
  description: string;
  prompt: string;
  isolateWorktree?: boolean;
};

function validateAssign(input: AssignInput):
  | {
      ok: true;
      subagentType: string;
      description: string;
      prompt: string;
    }
  | { ok: false; error: string } {
  const team = getTeamStore().get(input.teamId);
  if (!team) return { ok: false, error: `Unknown team_id: ${input.teamId}` };

  const fromMember = team.members.find((m) => m.name === input.from);
  const toMember = team.members.find((m) => m.name === input.to);
  if (!fromMember) return { ok: false, error: `Unknown from member: ${input.from}` };
  if (!toMember) return { ok: false, error: `Unknown to member: ${input.to}` };

  if (!isLeadRole(fromMember.role)) {
    return {
      ok: false,
      error: `Coordinator.assign requires from.role=lead (got ${fromMember.role})`,
    };
  }
  if (normalizeRole(toMember.role) === 'lead') {
    return { ok: false, error: 'Cannot assign to lead; assign to worker/explore' };
  }

  const subagentType = resolveSubagentType(toMember);
  if (!subagentType) {
    return {
      ok: false,
      error: `Member ${input.to} needs subagent_type (or role=explore)`,
    };
  }

  const manager = getSubagentManager();
  if (!manager.get(subagentType)) {
    return {
      ok: false,
      error: `Unknown subagent_type: ${subagentType}. Available: ${manager
        .list()
        .map((a) => a.name)
        .join(', ')}`,
    };
  }

  const description = input.description.trim();
  const prompt = input.prompt.trim();
  if (!description || !prompt) {
    return { ok: false, error: 'description and prompt required' };
  }

  return { ok: true, subagentType, description, prompt };
}

/**
 * lead → worker/explore：创建 Task + Team inbox 信封，默认后台跑 Subagent。
 */
export function coordinatorAssign(
  input: AssignInput & { background?: boolean },
  deps: CoordinatorRunDeps
):
  | { ok: true; assignment: CoordinatorAssignment; envelope: string }
  | { ok: false; error: string } {
  const checked = validateAssign(input);
  if (!checked.ok) return checked;

  const manager = getSubagentManager();
  const config = manager.get(checked.subagentType)!;
  const background = input.background !== false;
  const isolateWorktree = input.isolateWorktree !== false;

  let aborted = false;
  const taskStore = getTaskStore();
  const tracked = taskStore.begin({
    description: `[coord→${input.to}] ${checked.description}`,
    subagentType: checked.subagentType,
    background,
    abort: () => {
      aborted = true;
    },
  });

  const assignment = getCoordinatorStore().create({
    teamId: input.teamId,
    taskId: tracked.id,
    from: input.from,
    to: input.to,
    description: checked.description,
    subagentType: checked.subagentType,
  });

  const envelope = JSON.stringify(assignment);
  const inbox = getTeamStore().send({
    teamId: input.teamId,
    from: input.from,
    to: input.to,
    content: envelope,
  });
  if (!inbox.ok) {
    taskStore.fail(tracked.id, inbox.error);
    return { ok: false, error: `Inbox delivery failed: ${inbox.error}` };
  }

  const runOpts: SubagentRunOptions = {
    apiKey: deps.apiKey,
    baseUrl: deps.baseUrl,
    model: deps.model,
    toolRegistry: deps.toolRegistry,
    isolateWorktree,
    shouldAbort: () => aborted,
    ...deps.runOptions,
  };

  const fullPrompt = `${checked.description}\n\n${checked.prompt}\n\n[Coordinator ${COORDINATOR_CONTRACT} assignment_id=${assignment.assignment_id}]`;

  const finish = (result: Awaited<ReturnType<typeof manager.run>>): void => {
    if (aborted) {
      taskStore.markStopped(tracked.id);
      return;
    }
    taskStore.complete(tracked.id, { report: result.report, output: result.output });
  };

  if (background) {
    void manager
      .run(config, fullPrompt, runOpts)
      .then(finish)
      .catch((e) => {
        taskStore.fail(tracked.id, e instanceof Error ? e.message : String(e));
      });
  }

  return { ok: true, assignment, envelope };
}

/** 同步等待完成（测试与 background=false） */
export async function coordinatorAssignAwait(
  input: AssignInput,
  deps: CoordinatorRunDeps
): Promise<
  | { ok: true; assignment: CoordinatorAssignment; envelope: string }
  | { ok: false; error: string }
> {
  const checked = validateAssign(input);
  if (!checked.ok) return checked;

  const manager = getSubagentManager();
  const config = manager.get(checked.subagentType)!;
  const isolateWorktree = input.isolateWorktree !== false;
  const taskStore = getTaskStore();
  const tracked = taskStore.begin({
    description: `[coord→${input.to}] ${checked.description}`,
    subagentType: checked.subagentType,
    background: false,
  });

  const assignment = getCoordinatorStore().create({
    teamId: input.teamId,
    taskId: tracked.id,
    from: input.from,
    to: input.to,
    description: checked.description,
    subagentType: checked.subagentType,
  });

  const envelope = JSON.stringify(assignment);
  const inbox = getTeamStore().send({
    teamId: input.teamId,
    from: input.from,
    to: input.to,
    content: envelope,
  });
  if (!inbox.ok) {
    taskStore.fail(tracked.id, inbox.error);
    return { ok: false, error: `Inbox delivery failed: ${inbox.error}` };
  }

  try {
    const result = await manager.run(
      config,
      `${checked.description}\n\n${checked.prompt}\n\n[Coordinator ${COORDINATOR_CONTRACT} assignment_id=${assignment.assignment_id}]`,
      {
        apiKey: deps.apiKey,
        baseUrl: deps.baseUrl,
        model: deps.model,
        toolRegistry: deps.toolRegistry,
        isolateWorktree,
        ...deps.runOptions,
      }
    );
    taskStore.complete(tracked.id, { report: result.report, output: result.output });
  } catch (e) {
    taskStore.fail(tracked.id, e instanceof Error ? e.message : String(e));
  }

  return { ok: true, assignment, envelope };
}


export type AssignManyItem = {
  to: string;
  description: string;
  prompt: string;
};

/**
 * 并行扇出：lead → 多个 worker/explore。
 * background=false 时 Promise.all 等待全部完成；true 时全部后台启动。
 */
export async function coordinatorAssignMany(
  input: {
    teamId: string;
    from: string;
    items: AssignManyItem[];
    background?: boolean;
    isolateWorktree?: boolean;
  },
  deps: CoordinatorRunDeps
): Promise<
  | {
      ok: true;
      assignments: CoordinatorAssignment[];
      errors: Array<{ to: string; error: string }>;
    }
  | { ok: false; error: string }
> {
  if (!input.items.length) {
    return { ok: false, error: 'assign_many requires non-empty items' };
  }
  const background = input.background !== false;
  const assignments: CoordinatorAssignment[] = [];
  const errors: Array<{ to: string; error: string }> = [];

  if (background) {
    for (const item of input.items) {
      const r = coordinatorAssign(
        {
          teamId: input.teamId,
          from: input.from,
          to: item.to,
          description: item.description,
          prompt: item.prompt,
          isolateWorktree: input.isolateWorktree,
          background: true,
        },
        deps
      );
      if (r.ok) assignments.push(r.assignment);
      else errors.push({ to: item.to, error: r.error });
    }
  } else {
    const settled = await Promise.all(
      input.items.map(async (item) => {
        const r = await coordinatorAssignAwait(
          {
            teamId: input.teamId,
            from: input.from,
            to: item.to,
            description: item.description,
            prompt: item.prompt,
            isolateWorktree: input.isolateWorktree,
          },
          deps
        );
        return { item, r };
      })
    );
    for (const { item, r } of settled) {
      if (r.ok) assignments.push(r.assignment);
      else errors.push({ to: item.to, error: r.error });
    }
  }

  if (assignments.length === 0) {
    return {
      ok: false,
      error: errors.map((e) => `${e.to}: ${e.error}`).join('; ') || 'all assigns failed',
    };
  }
  return { ok: true, assignments, errors };
}

export function coordinatorPoll(teamId: string):
  | { ok: true; contract: typeof COORDINATOR_CONTRACT; items: CoordinatorPollItem[] }
  | { ok: false; error: string } {
  if (!getTeamStore().get(teamId)) {
    return { ok: false, error: `Unknown team_id: ${teamId}` };
  }
  const taskStore = getTaskStore();
  const items = getCoordinatorStore()
    .listForTeam(teamId)
    .map((a) => {
      const task = taskStore.get(a.task_id);
      return {
        assignment_id: a.assignment_id,
        task_id: a.task_id,
        to: a.to,
        description: a.description,
        status: task?.status ?? 'unknown',
        background: task?.background ?? false,
      };
    });
  return { ok: true, contract: COORDINATOR_CONTRACT, items };
}

/** Plain lines for /agents (no ANSI) — assignment_id · to · status · description */
export function formatCoordinatorAssignmentLine(item: CoordinatorPollItem): string {
  const mark =
    item.status === 'done'
      ? '✓'
      : item.status === 'error' || item.status === 'stopped'
        ? '✗'
        : '…';
  const bg = item.background ? ' (bg)' : '';
  return `${mark} ${item.assignment_id} · ${item.to} · ${item.status} · ${item.description}${bg}`;
}

/** Full section text for one team; empty string if no assignments */
export function formatCoordinatorAssignmentsForAgents(teamId: string): string {
  const poll = coordinatorPoll(teamId);
  if (!poll.ok) return `Coordinator: ${poll.error}`;
  if (poll.items.length === 0) return '';
  return [
    `Coordinator assignments (${poll.items.length}):`,
    ...poll.items.map(formatCoordinatorAssignmentLine),
  ].join('\n');
}

export function coordinatorCollect(
  teamId: string,
  assignmentIds?: string[]
): { ok: true; result: CoordinatorCollectResult } | { ok: false; error: string } {
  if (!getTeamStore().get(teamId)) {
    return { ok: false, error: `Unknown team_id: ${teamId}` };
  }

  let assignments = getCoordinatorStore().listForTeam(teamId);
  if (assignmentIds && assignmentIds.length > 0) {
    const want = new Set(assignmentIds);
    assignments = assignments.filter((a) => want.has(a.assignment_id));
  }

  const taskStore = getTaskStore();
  const done: string[] = [];
  const pending: string[] = [];
  const failed: string[] = [];
  const reports: CoordinatorCollectResult['reports'] = [];

  for (const a of assignments) {
    const task = taskStore.get(a.task_id);
    const status = task?.status ?? 'unknown';
    if (status === 'running') {
      pending.push(a.assignment_id);
      continue;
    }
    if (status === 'done' && task?.report) {
      done.push(a.assignment_id);
      // 核心：只回传 SubagentReport，不带对话原文
      reports.push({
        assignment_id: a.assignment_id,
        task_id: a.task_id,
        to: a.to,
        status,
        report: task.report,
      });
      continue;
    }
    if (status === 'error' || status === 'stopped') {
      failed.push(a.assignment_id);
      reports.push({
        assignment_id: a.assignment_id,
        task_id: a.task_id,
        to: a.to,
        status,
        report:
          task?.report ??
          ({
            agent: a.subagent_type,
            success: false,
            summary: task?.error ?? status,
            toolCalls: 0,
            durationMs: task ? (task.endedAt ?? Date.now()) - task.startedAt : 0,
            isolation: 'none' as const,
            error: task?.error,
          }),
      });
      continue;
    }
    pending.push(a.assignment_id);
  }

  return {
    ok: true,
    result: {
      contract: COORDINATOR_CONTRACT,
      team_id: teamId,
      done,
      pending,
      failed,
      reports,
    },
  };
}
