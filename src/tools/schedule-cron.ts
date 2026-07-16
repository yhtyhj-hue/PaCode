/**
 * K4: ScheduleCron — 进程内定时任务（list/create/delete/due）
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';
import { getCronStore, type CronStore } from '../services/cron/index.js';

export interface ScheduleCronDeps {
  store?: CronStore;
  now?: () => number;
}

export function registerScheduleCronTool(
  registry: { register: (t: ToolDefinition) => void },
  deps: ScheduleCronDeps = {}
): void {
  registry.register({
    name: 'ScheduleCron',
    description:
      'Manage in-process scheduled prompts (every:5m|1h, @hourly, @daily). No OS cron daemon. Actions: list, create, delete, due.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'delete', 'due'],
        },
        expression: {
          type: 'string',
          description: 'every:5m | every:1h | @hourly | @daily',
        },
        prompt: { type: 'string', description: 'Prompt to inject when due' },
        job_id: { type: 'string' },
      },
      required: ['action'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const {
        action,
        expression,
        prompt,
        job_id: jobId,
      } = input as {
        action: 'list' | 'create' | 'delete' | 'due';
        expression?: string;
        prompt?: string;
        job_id?: string;
      };

      const store = deps.store ?? getCronStore();
      const now = deps.now?.() ?? Date.now();

      if (action === 'list') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ jobs: store.list() }, null, 2),
            },
          ],
        };
      }

      if (action === 'create') {
        if (!expression || !prompt) {
          return {
            content: [{ type: 'text', text: 'create requires expression and prompt' }],
            isError: true,
          };
        }
        try {
          const job = store.create({ expression, prompt, now });
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: true, job }, null, 2) }],
          };
        } catch (e) {
          return {
            content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
            isError: true,
          };
        }
      }

      if (action === 'delete') {
        if (!jobId) {
          return {
            content: [{ type: 'text', text: 'delete requires job_id' }],
            isError: true,
          };
        }
        const ok = store.delete(jobId);
        return {
          content: [
            {
              type: 'text',
              text: ok
                ? JSON.stringify({ ok: true, deleted: jobId })
                : `Unknown job_id: ${jobId}`,
            },
          ],
          isError: !ok,
        };
      }

      // due
      const jobs = store.due(now);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                now,
                due_count: jobs.length,
                jobs: jobs.map((j) => ({
                  id: j.id,
                  prompt: j.prompt,
                  nextRunAt: j.nextRunAt,
                })),
                hint: 'Inject each prompt as a user turn, or call again later.',
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
