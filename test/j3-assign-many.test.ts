/**
 * J3: Coordinator assign_many parallel fan-out
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

beforeEach(() => {
  resetTeamStore();
  resetTaskStore();
  resetCoordinatorStore();
  resetSubagentManager();
});
afterEach(() => {
  resetTeamStore();
  resetTaskStore();
  resetCoordinatorStore();
  resetSubagentManager();
});

describe('J3 assign_many', () => {
  it('fans out to two workers in parallel and collect both', async () => {
    const registry = new ToolRegistry();
    registerTeamTools(registry);
    let calls = 0;
    registerCoordinatorTool(registry, {
      toolRegistry: registry,
      runOptions: {
        isolateWorktree: false,
        createEngine: () => {
          calls += 1;
          return new QueryEngine({
            anthropicClient: createMockAnthropicClient([
              textEndTurnScenario(`worker-${calls} done`),
            ]),
            toolRegistry: new ToolRegistry(),
            contextAssembler: stubAssembler(),
            compactionPipeline: passthroughCompaction(),
            prefetch: { enabled: false },
          });
        },
      },
    });

    const created = await registry.execute({
      id: 't', name: 'TeamCreate',
      input: {
        name: 'fanout',
        members: [
          { name: 'lead', role: 'lead' },
          { name: 'scout', role: 'explore', subagent_type: 'explore' },
          { name: 'worker', role: 'worker', subagent_type: 'general-purpose' },
        ],
      },
    }, ctx);
    const teamId = JSON.parse((created.content[0] as { text: string }).text).team_id as string;

    const many = await registry.execute({
      id: 'a', name: 'Coordinator',
      input: {
        action: 'assign_many',
        team_id: teamId,
        from: 'lead',
        background: false,
        isolate_worktree: false,
        assignments: [
          { to: 'scout', description: 'scan A', prompt: 'find A' },
          { to: 'worker', description: 'scan B', prompt: 'find B' },
        ],
      },
    }, ctx);
    expect(many.isError).toBeFalsy();
    const body = JSON.parse((many.content[0] as { text: string }).text);
    expect(body.contract).toBe(COORDINATOR_CONTRACT);
    expect(body.count).toBe(2);
    expect(body.assignment_ids).toHaveLength(2);
    expect(calls).toBe(2);

    const collected = await registry.execute({
      id: 'c', name: 'Coordinator',
      input: { action: 'collect', team_id: teamId },
    }, ctx);
    const coll = JSON.parse((collected.content[0] as { text: string }).text);
    expect(coll.done.length).toBe(2);
    expect(getTaskStore().list().filter((t) => t.status === 'done')).toHaveLength(2);
  });
});
