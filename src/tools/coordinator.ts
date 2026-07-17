/**
 * J3: Coordinator tool — assign / poll / collect（强契约 j3/v1）
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';
import {
  COORDINATOR_CONTRACT,
  coordinatorAssign,
  coordinatorAssignAwait,
  coordinatorAssignMany,
  coordinatorCollect,
  coordinatorPoll,
  type CoordinatorRunDeps,
} from '../services/coordinator/index.js';

export type CoordinatorToolDeps = CoordinatorRunDeps;

export function registerCoordinatorTool(
  registry: { register: (t: ToolDefinition) => void },
  deps: CoordinatorToolDeps
): void {
  registry.register({
    name: 'Coordinator',
    description:
      'Orchestrate a Team with strong contracts (j3/v1). Actions: assign (lead→worker Task+inbox), poll, collect (SubagentReport only). Not a second chat agent.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['assign', 'assign_many', 'poll', 'collect'],
          description: 'assign | assign_many | poll | collect',
        },
        team_id: { type: 'string' },
        from: { type: 'string', description: 'Must be lead member (assign)' },
        to: { type: 'string', description: 'worker/explore with subagent_type (assign)' },
        description: { type: 'string' },
        prompt: { type: 'string' },
        background: {
          type: 'boolean',
          description: 'Run assignment async (default true). false waits for completion.',
        },
        isolate_worktree: { type: 'boolean' },
        assignment_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional filter for collect',
        },
        assignments: {
          type: 'array',
          description: 'assign_many: [{ to, description, prompt }, ...]',
          items: {
            type: 'object',
            properties: {
              to: { type: 'string' },
              description: { type: 'string' },
              prompt: { type: 'string' },
            },
            required: ['to', 'description', 'prompt'],
          },
        },
      },
      required: ['action', 'team_id'],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const {
        action,
        team_id: teamId,
        from,
        to,
        description,
        prompt,
        background = true,
        isolate_worktree: isolateWorktree,
        assignment_ids: assignmentIds,
      } = input as {
        action: 'assign' | 'assign_many' | 'poll' | 'collect';
        team_id: string;
        from?: string;
        to?: string;
        description?: string;
        prompt?: string;
        background?: boolean;
        isolate_worktree?: boolean;
        assignment_ids?: string[];
      };

      if (action === 'poll') {
        const result = coordinatorPoll(teamId);
        if (!result.ok) {
          return { content: [{ type: 'text', text: result.error }], isError: true };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (action === 'collect') {
        const result = coordinatorCollect(teamId, assignmentIds);
        if (!result.ok) {
          return { content: [{ type: 'text', text: result.error }], isError: true };
        }
        // 禁止把 task.output 原文塞进 collect
        return {
          content: [{ type: 'text', text: JSON.stringify(result.result, null, 2) }],
        };
      }

      if (action === 'assign_many') {
        if (!from) {
          return {
            content: [{ type: 'text', text: 'assign_many requires from (lead)' }],
            isError: true,
          };
        }
        const items = (input as { assignments?: Array<{ to: string; description: string; prompt: string }> })
          .assignments;
        if (!items?.length) {
          return {
            content: [{ type: 'text', text: 'assign_many requires assignments[]' }],
            isError: true,
          };
        }
        const many = await coordinatorAssignMany(
          {
            teamId,
            from,
            items,
            background: background !== false,
            isolateWorktree,
          },
          deps
        );
        if (!many.ok) {
          return { content: [{ type: 'text', text: many.error }], isError: true };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  contract: COORDINATOR_CONTRACT,
                  action: 'assign_many',
                  team_id: teamId,
                  assignment_ids: many.assignments.map((a) => a.assignment_id),
                  count: many.assignments.length,
                  errors: many.errors,
                  background: background !== false,
                  hint: 'Use Coordinator poll/collect for results.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // assign
      if (!from || !to || !description || !prompt) {
        return {
          content: [
            {
              type: 'text',
              text: 'assign requires from, to, description, prompt',
            },
          ],
          isError: true,
        };
      }

      const assignInput = {
        teamId,
        from,
        to,
        description,
        prompt,
        isolateWorktree,
      };

      const result =
        background === false
          ? await coordinatorAssignAwait(assignInput, deps)
          : coordinatorAssign({ ...assignInput, background: true }, deps);

      if (!result.ok) {
        return { content: [{ type: 'text', text: result.error }], isError: true };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                contract: COORDINATOR_CONTRACT,
                assignment_id: result.assignment.assignment_id,
                task_id: result.assignment.task_id,
                team_id: result.assignment.team_id,
                to: result.assignment.to,
                background: background !== false,
                hint: 'Use Coordinator poll/collect; TaskGet for task status.',
              },
              null,
              2
            ),
          },
        ],
      };
    },
  });
}
