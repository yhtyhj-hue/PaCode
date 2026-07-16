/**
 * I4: Planning tools — EnterPlanMode / ExitPlanMode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerPlanModeTools } from '../src/tools/plan-mode.js';
import { resetPlanManager } from '../src/agent/plan-mode.js';
import { PermissionMode } from '../src/pkg/types.js';

beforeEach(() => {
  resetPlanManager();
});

describe('I4 plan mode tools', () => {
  it('registers both tools on the registry', () => {
    const r = new ToolRegistry();
    registerPlanModeTools(r);
    expect(r.has('EnterPlanMode')).toBe(true);
    expect(r.has('ExitPlanMode')).toBe(true);
  });

  it('EnterPlanMode creates a plan with steps', async () => {
    const r = new ToolRegistry();
    registerPlanModeTools(r);
    const result = await r.execute(
      {
        id: '1',
        name: 'EnterPlanMode',
        input: {
          title: 'Refactor auth',
          description: 'Split auth.ts into modules',
          steps: [
            { action: 'read', tool: 'Read', description: 'Read auth.ts' },
            { action: 'extract', description: 'Extract helpers' },
            { action: 'write', tool: 'Write', description: 'Write new module', estimated_risk: 'medium' },
          ],
        },
      },
      { workingDirectory: '/tmp', sessionState: {} as never, hooks: {} as never }
    );
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Plan created:');
    expect(text).toContain('3 steps');
  });

  it('ExitPlanMode without an active plan returns isError', async () => {
    const r = new ToolRegistry();
    registerPlanModeTools(r);
    const result = await r.execute(
      { id: '1', name: 'ExitPlanMode', input: {} },
      { workingDirectory: '/tmp', sessionState: {} as never, hooks: {} as never }
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No active plan');
  });

  it('ExitPlanMode after EnterPlanMode marks the plan executing', async () => {
    const r = new ToolRegistry();
    registerPlanModeTools(r);

    await r.execute(
      {
        id: '1',
        name: 'EnterPlanMode',
        input: {
          title: 'Plan A',
          steps: [{ action: 'a', description: 'step a' }],
        },
      },
      { workingDirectory: '/tmp', sessionState: {} as never, hooks: {} as never }
    );

    const exit = await r.execute(
      { id: '2', name: 'ExitPlanMode', input: {} },
      { workingDirectory: '/tmp', sessionState: {} as never, hooks: {} as never }
    );
    expect(exit.isError).toBeFalsy();
    const text = (exit.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('approved and started');
  });

  it('EnterPlanMode uses PermissionMode.PLAN', () => {
    const r = new ToolRegistry();
    registerPlanModeTools(r);
    expect(r.get('EnterPlanMode')?.permissionMode).toBe(PermissionMode.PLAN);
  });
});