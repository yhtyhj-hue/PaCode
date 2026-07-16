/**
 * J3 — Coordinator assign/poll/collect + j3/v1 契约
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerCoreTools } from '../src/tools/bootstrap.js';
import { registerCoordinatorTool } from '../src/tools/coordinator.js';
import { registerTeamTools } from '../src/tools/team.js';
import { getTeamStore, resetTeamStore } from '../src/services/team/index.js';
import { getTaskStore, resetTaskStore } from '../src/services/task-registry/index.js';
import {
  COORDINATOR_CONTRACT,
  getCoordinatorStore,
  parseCoordinatorEnvelope,
  resetCoordinatorStore,
} from '../src/services/coordinator/index.js';
import { getSubagentManager, resetSubagentManager, registryWithoutTask } from '../src/agent/subagent.js';

const ctx = {
  workingDirectory: process.cwd(),
  sessionState: {} as never,
  hooks: {} as never,
};

function mockSubagentOk(summary = 'worker done') {
  return vi.spyOn(getSubagentManager(), 'run').mockResolvedValue({
    name: 'explore',
    success: true,
    output: `VERBOSE BLOB ${summary} should not appear in collect`,
    toolCalls: 2,
    duration: 40,
    report: {
      agent: 'explore',
      success: true,
      summary,
      toolCalls: 2,
      durationMs: 40,
      isolation: 'none',
    },
  });
}

describe('J3 parseCoordinatorEnvelope', () => {
  it('rejects missing contract', () => {
    const bad = parseCoordinatorEnvelope(JSON.stringify({ assignment_id: 'x' }));
    expect(bad.ok).toBe(false);
  });

  it('accepts j3/v1 envelope', () => {
    const ok = parseCoordinatorEnvelope(
      JSON.stringify({
        contract: COORDINATOR_CONTRACT,
        assignment_id: 'asn_1',
        task_id: 'task_1',
        team_id: 'team_1',
        from: 'lead',
        to: 'scout',
        description: 'd',
        subagent_type: 'explore',
        created_at: 1,
      })
    );
    expect(ok.ok).toBe(true);
  });
});

describe('J3 Coordinator tool', () => {
  beforeEach(() => {
    resetTeamStore();
    resetTaskStore();
    resetCoordinatorStore();
    resetSubagentManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetTeamStore();
    resetTaskStore();
    resetCoordinatorStore();
    resetSubagentManager();
  });

  async function createTeam(registry: ToolRegistry) {
    const created = await registry.execute(
      {
        id: 't',
        name: 'TeamCreate',
        input: {
          name: 'coord-team',
          members: [
            { name: 'lead', role: 'lead' },
            { name: 'scout', role: 'explore', subagent_type: 'explore' },
            { name: 'worker', role: 'worker', subagent_type: 'general-purpose' },
          ],
        },
      },
      ctx
    );
    return JSON.parse((created.content[0] as { text: string }).text).team_id as string;
  }

  it('lead assign → inbox envelope + poll/collect reports only', async () => {
    mockSubagentOk('found issues');
    const registry = new ToolRegistry();
    registerTeamTools(registry);
    registerCoordinatorTool(registry, {
      toolRegistry: registry,
      runOptions: { isolateWorktree: false },
    });

    const teamId = await createTeam(registry);

    const assigned = await registry.execute(
      {
        id: '1',
        name: 'Coordinator',
        input: {
          action: 'assign',
          team_id: teamId,
          from: 'lead',
          to: 'scout',
          description: 'scan',
          prompt: 'look for TODOs',
          background: false,
          isolate_worktree: false,
        },
      },
      ctx
    );
    expect(assigned.isError).toBeFalsy();
    const meta = JSON.parse((assigned.content[0] as { text: string }).text);
    expect(meta.contract).toBe(COORDINATOR_CONTRACT);
    expect(meta.task_id).toMatch(/^task_/);

    const inbox = getTeamStore().receive(teamId, 'scout');
    expect(inbox.ok).toBe(true);
    if (!inbox.ok) return;
    const env = parseCoordinatorEnvelope(inbox.messages[0]!.content);
    expect(env.ok).toBe(true);

    const polled = await registry.execute(
      { id: '2', name: 'Coordinator', input: { action: 'poll', team_id: teamId } },
      ctx
    );
    const pollBody = JSON.parse((polled.content[0] as { text: string }).text);
    expect(pollBody.contract).toBe(COORDINATOR_CONTRACT);
    expect(pollBody.items[0].status).toBe('done');

    const collected = await registry.execute(
      { id: '3', name: 'Coordinator', input: { action: 'collect', team_id: teamId } },
      ctx
    );
    const text = (collected.content[0] as { text: string }).text;
    expect(text).not.toContain('VERBOSE BLOB');
    const body = JSON.parse(text);
    expect(body.contract).toBe(COORDINATOR_CONTRACT);
    expect(body.done).toContain(meta.assignment_id);
    expect(body.reports[0].report.summary).toBe('found issues');
    expect(body.reports[0].report).not.toHaveProperty('output');
  });

  it('rejects non-lead assign', async () => {
    const registry = new ToolRegistry();
    registerTeamTools(registry);
    registerCoordinatorTool(registry, { toolRegistry: registry });
    const teamId = await createTeam(registry);

    const result = await registry.execute(
      {
        id: '1',
        name: 'Coordinator',
        input: {
          action: 'assign',
          team_id: teamId,
          from: 'scout',
          to: 'worker',
          description: 'x',
          prompt: 'y',
        },
      },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('from.role=lead');
  });

  it('rejects worker without subagent_type', async () => {
    const registry = new ToolRegistry();
    registerTeamTools(registry);
    registerCoordinatorTool(registry, { toolRegistry: registry });

    const created = await registry.execute(
      {
        id: 't',
        name: 'TeamCreate',
        input: {
          name: 'bad',
          members: [
            { name: 'lead', role: 'lead' },
            { name: 'naked', role: 'worker' },
          ],
        },
      },
      ctx
    );
    const teamId = JSON.parse((created.content[0] as { text: string }).text).team_id;

    const result = await registry.execute(
      {
        id: '1',
        name: 'Coordinator',
        input: {
          action: 'assign',
          team_id: teamId,
          from: 'lead',
          to: 'naked',
          description: 'x',
          prompt: 'y',
        },
      },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('subagent_type');
  });

  it('nested registry blocks Coordinator, keeps SendMessage', () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry, { task: { toolRegistry: registry } });
    const nested = registryWithoutTask(registry);
    expect(nested.has('Coordinator')).toBe(false);
    expect(nested.has('SendMessage')).toBe(true);
  });

  it('bootstrap includes Coordinator among core tools', () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry, { task: { toolRegistry: registry } });
    expect(registry.has('Coordinator')).toBe(true);
    expect(registry.list().length).toBeGreaterThanOrEqual(22);
  });
});
