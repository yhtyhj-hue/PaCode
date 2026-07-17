/**
 * J3 live path: Team -> Coordinator assignAwait -> poll -> collect
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerTeamTools } from '../src/tools/team.js';
import { registerCoordinatorTool } from '../src/tools/coordinator.js';
import { getTeamStore, resetTeamStore } from '../src/services/team/index.js';
import { getTaskStore, resetTaskStore } from '../src/services/task-registry/index.js';
import { COORDINATOR_CONTRACT, resetCoordinatorStore } from '../src/services/coordinator/index.js';
import { resetSubagentManager } from '../src/agent/subagent.js';
import { QueryEngine } from '../src/agent/engine.js';
import { createMockAnthropicClient, textEndTurnScenario } from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

const ctx = { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never };
beforeEach(() => { resetTeamStore(); resetTaskStore(); resetCoordinatorStore(); resetSubagentManager(); });
afterEach(() => { resetTeamStore(); resetTaskStore(); resetCoordinatorStore(); resetSubagentManager(); });

describe('J3 Coordinator live SubagentManager', () => {
  it('assign poll collect with real subagent engine', async () => {
    const registry = new ToolRegistry();
    registerTeamTools(registry);
    registerCoordinatorTool(registry, {
      toolRegistry: registry,
      runOptions: {
        isolateWorktree: false,
        createEngine: () => new QueryEngine({
          anthropicClient: createMockAnthropicClient([textEndTurnScenario('scout summary: 2 hotspots')]),
          toolRegistry: new ToolRegistry(),
          contextAssembler: stubAssembler(),
          compactionPipeline: passthroughCompaction(),
          prefetch: { enabled: false },
        }),
      },
    });
    const created = await registry.execute({
      id: 't', name: 'TeamCreate',
      input: { name: 'live-coord', members: [
        { name: 'lead', role: 'lead' },
        { name: 'scout', role: 'explore', subagent_type: 'explore' },
      ]},
    }, ctx);
    const teamId = JSON.parse((created.content[0] as { text: string }).text).team_id as string;
    const assigned = await registry.execute({
      id: 'a', name: 'Coordinator',
      input: {
        action: 'assign', team_id: teamId, from: 'lead', to: 'scout',
        description: 'Scan for hotspots', prompt: 'List two hotspots briefly.',
        background: false, isolate_worktree: false,
      },
    }, ctx);
    expect(assigned.isError).toBeFalsy();
    expect(JSON.parse((assigned.content[0] as { text: string }).text).contract).toBe(COORDINATOR_CONTRACT);
    expect(getTeamStore().receive(teamId, 'scout').ok).toBe(true);
    const pollBody = JSON.parse(((await registry.execute(
      { id: 'p', name: 'Coordinator', input: { action: 'poll', team_id: teamId } }, ctx
    )).content[0] as { text: string }).text);
    expect(pollBody.items?.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(((await registry.execute(
      { id: 'c', name: 'Coordinator', input: { action: 'collect', team_id: teamId } }, ctx
    )).content[0] as { text: string }).text);
    expect(body.done.length).toBeGreaterThanOrEqual(1);
    expect(body.reports[0].report.summary).toContain('scout summary');
    expect(getTaskStore().list().some((t) => t.status === 'done')).toBe(true);
  });
});
