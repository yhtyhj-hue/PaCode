/**
 * Task Tool - 真 Subagent 委托（I6 worktree + J1 登记可见）
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';
import { ToolRegistry } from './registry.js';
import { getSubagentManager } from '../agent/subagent.js';
import { getTaskStore } from '../services/task-registry/index.js';

export interface TaskToolDeps {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  toolRegistry: ToolRegistry;
}

export function registerTaskTool(
  registry: { register: (t: ToolDefinition) => void },
  deps: TaskToolDeps
) {
  registry.register({
    name: 'Task',
    description:
      'Delegate a task to an isolated subagent (separate QueryEngine; default git worktree). Use TaskList/TaskGet/TaskStop for visibility. Not a prefetch worker.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Short task description' },
        prompt: { type: 'string', description: 'Detailed task for the subagent' },
        subagent_type: {
          type: 'string',
          description: 'Subagent type: general-purpose, explore, plan, or security-review',
        },
        isolate_worktree: {
          type: 'boolean',
          description: 'Run in ephemeral git worktree (default true)',
        },
        keep_worktree: {
          type: 'boolean',
          description: 'Keep worktree after completion (default false)',
        },
        run_in_background: {
          type: 'boolean',
          description:
            'Return task id immediately and run async (default false). Required for TaskStop while running.',
        },
      },
      required: ['description', 'prompt'],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const {
        prompt,
        description,
        subagent_type: subagentType = 'general-purpose',
        isolate_worktree: isolateWorktree = true,
        keep_worktree: keepWorktree = false,
        run_in_background: runInBackground = false,
      } = input as {
        prompt: string;
        description: string;
        subagent_type?: string;
        isolate_worktree?: boolean;
        keep_worktree?: boolean;
        run_in_background?: boolean;
      };

      const manager = getSubagentManager();
      const config = manager.get(subagentType);

      if (!config) {
        return {
          content: [
            {
              type: 'text',
              text: `Unknown subagent type: ${subagentType}. Available: ${manager
                .list()
                .map((a) => a.name)
                .join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      const store = getTaskStore();
      let aborted = false;
      const tracked = store.begin({
        description,
        subagentType,
        background: runInBackground,
        abort: () => {
          aborted = true;
        },
      });

      const runOpts = {
        apiKey: deps.apiKey,
        baseUrl: deps.baseUrl,
        model: deps.model,
        toolRegistry: deps.toolRegistry,
        isolateWorktree,
        keepWorktree,
        shouldAbort: () => aborted,
      };

      if (runInBackground) {
        // 核心：立即返回 id；Stop 通过 abort 标志中止子引擎
        void manager
          .run(config, `${description}\n\n${prompt}`, runOpts)
          .then((result) => {
            if (aborted) {
              store.markStopped(tracked.id);
              return;
            }
            store.complete(tracked.id, { report: result.report, output: result.output });
          })
          .catch((e) => {
            store.fail(tracked.id, e instanceof Error ? e.message : String(e));
          });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                task_id: tracked.id,
                status: 'running',
                background: true,
                message: `Background task started. Use TaskGet/TaskList with id ${tracked.id}.`,
              }),
            },
          ],
        };
      }

      const result = await manager.run(config, `${description}\n\n${prompt}`, runOpts);

      if (aborted) {
        store.markStopped(tracked.id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                task_id: tracked.id,
                status: 'stopped',
                message: 'Task was stopped',
              }),
            },
          ],
          isError: true,
        };
      }

      store.complete(tracked.id, { report: result.report, output: result.output });

      if (!result.success) {
        return {
          content: [
            {
              type: 'text',
              text: `task_id: ${tracked.id}\n${result.output || result.error || 'Subagent failed'}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `task_id: ${tracked.id}\n${result.output}`,
          },
        ],
      };
    },
  });
}
