/**
 * I4: Planning tools — EnterPlanMode / ExitPlanMode.
 *
 * Lets the model formally enter and leave plan mode from a
 * tool_use call, rather than only via the /plan slash command.
 * Plan execution is driven by the existing engine loop after
 * exit (the same way /plan execute already works in REPL).
 */

import { PermissionMode, ToolContext } from '../pkg/types.js';
import { ToolRegistry } from './registry.js';
import { getPlanManager } from '../agent/plan-mode.js';

export const ENTER_PLAN_MODE_TOOL = 'EnterPlanMode';
export const EXIT_PLAN_MODE_TOOL = 'ExitPlanMode';

export function registerPlanModeTools(registry: ToolRegistry): void {
  registry.register({
    name: ENTER_PLAN_MODE_TOOL,
    description:
      'Enter plan mode and create a structured plan from a user request. ' +
      'After this call, ExitPlanMode (or the next /plan step) drives execution. ' +
      'The plan is added to the active session and is auditable via /plan list.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              tool: { type: 'string' },
              description: { type: 'string' },
              estimated_risk: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
              },
            },
            required: ['action', 'description'],
          },
        },
      },
      required: ['title', 'steps'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.PLAN,
    async execute(input, _ctx?: ToolContext) {
      const args = input as {
        title: string;
        description?: string;
        steps: Array<{
          action: string;
          tool?: string;
          description: string;
          estimated_risk?: 'low' | 'medium' | 'high';
        }>;
      };
      const pm = getPlanManager();
      const plan = pm.createPlan(
        args.title,
        args.description ?? '',
        args.steps.map((s, i) => ({
          index: i,
          action: s.action,
          tool: s.tool,
          description: s.description,
          estimatedRisk: s.estimated_risk ?? 'low',
        }))
      );
      return {
        content: [
          {
            type: 'text',
            text: `Plan created: ${plan.id} (${args.steps.length} steps). ` +
              `Call ExitPlanMode to start execution, or /plan reject ${plan.id} to cancel.`,
          },
        ],
      };
    },
  });

  registry.register({
    name: EXIT_PLAN_MODE_TOOL,
    description:
      'Exit plan mode after creating a plan with EnterPlanMode. ' +
      'Marks the plan approved and starts execution via the engine loop. ' +
      'No-op when there is no active plan.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
      },
    },
    concurrencySafe: true,
    // PLAN：会话在 plan 时 tool-gate 可通过；PermissionSystem 白名单放行 ExitPlanMode
    permissionMode: PermissionMode.PLAN,
    async execute(input, _ctx?: ToolContext) {
      const args = input as { plan_id?: string };
      const pm = getPlanManager();
      const plan = pm.getActive();
      if (!plan) {
        return {
          content: [
            { type: 'text', text: 'No active plan to exit. Create one with EnterPlanMode first.' },
          ],
          isError: true,
        };
      }
      if (args.plan_id && args.plan_id !== plan.id) {
        return {
          content: [
            { type: 'text', text: `Active plan is ${plan.id}, not ${args.plan_id}.` },
          ],
          isError: true,
        };
      }
      if (plan.status === 'draft') {
        pm.approve(plan.id);
      }
      const started = pm.startExecution(plan.id);
      if (!started) {
        return {
          content: [
            { type: 'text', text: `Plan ${plan.id} cannot be executed (status: ${plan.status}).` },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Plan ${plan.id} approved and started (${plan.steps.length} steps). ` +
              `Session leaves PLAN; QueryEngine injects each step until the plan completes.`,
          },
        ],
      };
    },
  });
}