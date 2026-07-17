/**
 * J3: /agents shows Coordinator assign_many rows
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { REPL } from '../src/cli/repl.js';
import { SessionManager } from '../src/session/manager.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { HookRegistry } from '../src/hooks/registry.js';
import { PermissionMode } from '../src/pkg/types.js';
import { getTeamStore, resetTeamStore } from '../src/services/team/index.js';
import { getTaskStore, resetTaskStore } from '../src/services/task-registry/index.js';
import {
  getCoordinatorStore,
  resetCoordinatorStore,
  formatCoordinatorAssignmentLine,
  formatCoordinatorAssignmentsForAgents,
  coordinatorPoll,
} from '../src/services/coordinator/index.js';
import type { SubagentReport } from '../src/agent/subagent.js';

beforeEach(() => {
  resetTeamStore();
  resetTaskStore();
  resetCoordinatorStore();
});
afterEach(() => {
  resetTeamStore();
  resetTaskStore();
  resetCoordinatorStore();
});

function seedAssignMany(): { teamId: string; asnIds: string[] } {
  const team = getTeamStore().create({
    name: 'vis',
    members: [
      { name: 'lead', role: 'lead' },
      { name: 'scout', role: 'explore', subagentType: 'explore' },
      { name: 'worker', role: 'worker', subagentType: 'general-purpose' },
    ],
  });
  if (!team.ok) throw new Error(team.error);
  const teamId = team.team.id;
  const t1 = getTaskStore().begin({
    description: 'scan A',
    subagentType: 'explore',
    background: true,
  });
  const t2 = getTaskStore().begin({
    description: 'scan B',
    subagentType: 'general-purpose',
    background: true,
  });
  const report: SubagentReport = {
    agent: 'explore',
    success: true,
    summary: 'A ok',
    toolCalls: 0,
    durationMs: 1,
    isolation: 'cwd',
  };
  getTaskStore().complete(t1.id, { report, output: 'A' });
  const a1 = getCoordinatorStore().create({
    teamId,
    taskId: t1.id,
    from: 'lead',
    to: 'scout',
    description: 'scan A',
    subagentType: 'explore',
  });
  const a2 = getCoordinatorStore().create({
    teamId,
    taskId: t2.id,
    from: 'lead',
    to: 'worker',
    description: 'scan B',
    subagentType: 'general-purpose',
  });
  return { teamId, asnIds: [a1.assignment_id, a2.assignment_id] };
}

describe('J3 /agents coordinator visibility', () => {
  it('formatCoordinatorAssignmentsForAgents lists poll-joined status', () => {
    const { teamId, asnIds } = seedAssignMany();
    const text = formatCoordinatorAssignmentsForAgents(teamId);
    expect(text).toContain('Coordinator assignments (2)');
    expect(text).toContain(asnIds[0]!);
    expect(text).toContain('scout');
    expect(text).toContain('✓'); // done
    expect(text).toContain('…'); // running
    expect(text).toContain('scan B');
    const poll = coordinatorPoll(teamId);
    expect(poll.ok).toBe(true);
    if (poll.ok) {
      expect(formatCoordinatorAssignmentLine(poll.items[0]!)).toMatch(/asn_/);
    }
  });

  it('/agents prints assignment rows', async () => {
    const { teamId, asnIds } = seedAssignMany();
    const sessionDir = mkdtempSync(join(tmpdir(), 'pacode-agents-vis-'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const repl = new REPL({
        apiKey: 'test-key',
        model: 'claude-sonnet-4-0',
        mode: PermissionMode.DEFAULT,
        provider: { name: 'test', apiKey: 'test-key' },
        sessionManager: new SessionManager(sessionDir),
        toolRegistry: new ToolRegistry(),
        hookRegistry: new HookRegistry(),
      });
      await repl.dispatchSlashCommand('/agents');
      const joined = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(joined).toContain(teamId);
      expect(joined).toContain(asnIds[0]!);
      expect(joined).toContain('scout');
      expect(joined).toContain('scan A');
      expect(joined).toContain('2 assignments');
      expect(joined).toContain('assign_many');
    } finally {
      logSpy.mockRestore();
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });
});
