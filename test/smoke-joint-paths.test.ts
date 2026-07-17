/**
 * 联合冒烟：质检 prefetch · checkpoint/rewind · Team · ExitPlanMode@PLAN
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { QueryEngine } from '../src/agent/engine.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerCoreTools } from '../src/tools/bootstrap.js';
import { registerPlanModeTools } from '../src/tools/plan-mode.js';
import { PermissionMode } from '../src/pkg/types.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
  toolUseScenario,
} from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';
import { captureCheckpoint, listCheckpoints } from '../src/services/checkpoint.js';
import { getTeamStore, resetTeamStore } from '../src/services/team/index.js';
import { getPlanManager, resetPlanManager } from '../src/agent/plan-mode.js';
import { requiresToolExecution } from '../src/agent/tool-intent.js';
import { resolveDagPlan } from '../src/services/agent-scheduler/intents.js';

function createState(mode: PermissionMode) {
  return {
    sessionId: `smoke-${Date.now()}`,
    messages: [] as Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>,
    toolCallHistory: [],
    maxOutputTokensRecoveryCount: 0,
    mode,
    hooks: { hooks: {} },
    compactionHistory: [],
    sessionApprovals: [],
  };
}

describe('smoke: 质检 prefetch intent', () => {
  it('质检 triggers tool requirement + code_audit/inspect DAG', () => {
    expect(requiresToolExecution('对项目做一次深度质检')).toBe(true);
    const plan = resolveDagPlan('检查这个项目');
    expect(plan).not.toBeNull();
    expect(['inspect_project', 'code_audit', 'review_implementation']).toContain(
      plan?.intent
    );
  });
});

describe('smoke: checkpoint + rewind', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'smoke-cp-'));
    execFileSync('git', ['init', '-q', '-b', 'main', workDir], { stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: workDir });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: workDir });
    writeFileSync(join(workDir, 'f.txt'), 'v1\n');
    execFileSync('git', ['add', '.'], { cwd: workDir });
    execFileSync('git', ['commit', '-m', 'init', '-q'], { cwd: workDir });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('capture + list (rewindTo covered in i2)', () => {
    writeFileSync(join(workDir, 'f.txt'), 'v2\n');
    const meta = captureCheckpoint('smoke', 0, 'Edit', workDir);
    expect(meta).not.toBeNull();
    const listed = listCheckpoints(workDir);
    expect(listed.some((c) => c.id === meta!.id)).toBe(true);
  });
});

describe('smoke: TeamCreate + SendMessage', () => {
  beforeEach(() => resetTeamStore());
  afterEach(() => resetTeamStore());

  it('registry path creates team and delivers message', async () => {
    const reg = new ToolRegistry();
    registerCoreTools(reg, { task: { toolRegistry: reg } });
    const ctx = {
      workingDirectory: process.cwd(),
      sessionState: {} as never,
      hooks: {} as never,
    };
    const created = await reg.execute(
      {
        id: '1',
        name: 'TeamCreate',
        input: {
          name: 'smoke-team',
          members: [
            { name: 'lead', role: 'lead' },
            { name: 'w', role: 'worker' },
          ],
        },
      },
      ctx
    );
    expect(created.isError).toBeFalsy();
    const teamId = getTeamStore().list()[0]?.id;
    expect(teamId).toBeTruthy();
    const sent = await reg.execute(
      {
        id: '2',
        name: 'SendMessage',
        input: {
          action: 'send',
          team_id: teamId,
          from: 'lead',
          to: 'w',
          content: 'ping',
        },
      },
      ctx
    );
    expect(sent.isError).toBeFalsy();
    const inbox = getTeamStore().receive(teamId!, 'w');
    expect(inbox.ok && inbox.messages[0]?.content).toBe('ping');
  });
});

describe('smoke: ExitPlanMode under PLAN via QueryEngine', () => {
  beforeEach(() => resetPlanManager());
  afterEach(() => resetPlanManager());

  it('model can call ExitPlanMode when session is PLAN', async () => {
    const registry = new ToolRegistry();
    registerPlanModeTools(registry);

    const pm = getPlanManager();
    pm.createPlan('Smoke plan', 'desc', [
      { index: 0, action: 'do', description: 'step', estimatedRisk: 'low' },
    ]);

    const client = createMockAnthropicClient([
      toolUseScenario('tu_exit', 'ExitPlanMode', {}),
      textEndTurnScenario('Exited plan'),
    ]);

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      permissionPrompt: async () => true,
    });

    const state = createState(PermissionMode.PLAN);
    state.messages.push({ role: 'user', content: 'exit plan', timestamp: Date.now() });

    const events = [];
    for await (const e of engine.query({ message: 'exit plan' }, state)) {
      events.push(e);
    }

    expect(events.some((e) => e.type === 'tool_use' && e.tool?.name === 'ExitPlanMode')).toBe(
      true
    );
    const result = events.find((e) => e.type === 'tool_result');
    expect(result?.result?.isError).toBeFalsy();
    expect(pm.getActive()?.status).toBe('executing');
  });
});
