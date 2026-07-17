/**
 * /agents 纯文本报告 — REPL 与 TUI 共用，避免双份逻辑
 */

import { getSubagentManager } from '../agent/subagent.js';
import { getAgentPool } from '../services/agent-scheduler/index.js';
import { getTaskStore } from '../services/task-registry/index.js';
import { getTeamStore } from '../services/team/index.js';
import {
  coordinatorPoll,
  formatCoordinatorAssignmentLine,
} from '../services/coordinator/index.js';

const MAX_TASKS = 12;
const MAX_TEAMS = 8;
const MAX_ASSIGNMENTS = 12;

/** 生成 /agents 各节行（无 ANSI） */
export function formatAgentsReportLines(): string[] {
  const lines: string[] = [];
  const pool = getAgentPool();
  const running = pool.snapshot();
  const registered = getSubagentManager().list();
  const tasks = getTaskStore().list().slice(0, MAX_TASKS);
  const teams = getTeamStore().list().slice(0, MAX_TEAMS);

  if (pool.activeQueryId() && running.length > 0) {
    lines.push(`Prefetch workers (same-process DAG): ${pool.activeQueryId()}`);
    for (const run of running) {
      const hint = run.currentTool ?? run.status;
      lines.push(
        `  · ${run.label} (${run.agentType}) · ${run.status} · ${run.toolCalls} tools · ${hint}`
      );
    }
    lines.push('');
  }

  if (tasks.length > 0) {
    lines.push('Task runs (Subagent / TaskGet):');
    for (const t of tasks) {
      lines.push(
        `  · ${t.id} · ${t.status} · ${t.subagentType} · ${t.description}${t.background ? ' (bg)' : ''}`
      );
    }
    lines.push('');
  }

  if (teams.length > 0) {
    lines.push('Teams (TeamCreate / SendMessage / Coordinator):');
    for (const t of teams) {
      const poll = coordinatorPoll(t.id);
      const items = poll.ok ? poll.items : [];
      lines.push(
        `  · ${t.id} · ${t.name} · ${t.memberCount} members · ${t.unreadCount} unread · ${items.length} assignments`
      );
      for (const a of items.slice(0, MAX_ASSIGNMENTS)) {
        lines.push(`    ${formatCoordinatorAssignmentLine(a)}`);
      }
    }
    lines.push('');
  }

  lines.push('Registered subagent types:');
  if (registered.length === 0) {
    lines.push('  (none)');
  } else {
    for (const agent of registered) {
      lines.push(`  · ${agent.name} — ${agent.description}`);
    }
  }
  lines.push('');
  lines.push(
    'Task/Team/Coordinator → real subagents + inbox. Prefetch workers ≠ Team. assign_many → assignment rows above.'
  );
  return lines;
}

export function formatAgentsReport(): string {
  return formatAgentsReportLines().join('\n');
}
