/**
 * J1: TaskList / TaskGet / TaskStop — Task 结果可见与中止
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';
import { getTaskStore } from '../services/task-registry/index.js';

export function registerTaskControlTools(registry: {
  register: (t: ToolDefinition) => void;
}): void {
  registry.register({
    name: 'TaskList',
    description: 'List delegated Task runs (id, status, description). Prefer over guessing.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute() {
      const items = getTaskStore().list();
      return {
        content: [
          {
            type: 'text',
            text: items.length === 0 ? 'No tasks recorded.' : JSON.stringify(items, null, 2),
          },
        ],
      };
    },
  });

  registry.register({
    name: 'TaskGet',
    description: 'Get full result/report for a Task by id (visibility after or during background run).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task id from Task tool output' },
      },
      required: ['task_id'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const { task_id: taskId } = input as { task_id: string };
      const task = getTaskStore().get(taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: `Unknown task_id: ${taskId}` }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                id: task.id,
                description: task.description,
                subagentType: task.subagentType,
                status: task.status,
                background: task.background,
                startedAt: task.startedAt,
                endedAt: task.endedAt,
                error: task.error,
                report: task.report,
                output: task.output,
              },
              null,
              2
            ),
          },
        ],
      };
    },
  });

  registry.register({
    name: 'TaskStop',
    description:
      'Request stop of a running background Task. Sync Task usually finishes before Stop can apply.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
      },
      required: ['task_id'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const { task_id: taskId } = input as { task_id: string };
      const store = getTaskStore();
      const result = store.requestStop(taskId);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: result.reason ?? 'Stop failed' }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              task_id: taskId,
              stop_requested: true,
              message: 'Abort signaled; TaskGet until status is stopped/done/error.',
            }),
          },
        ],
      };
    },
  });
}
