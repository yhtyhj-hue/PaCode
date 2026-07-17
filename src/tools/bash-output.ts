/**
 * BashOutput / BashStop — 后台 Bash 可观测性（对标 CC BashOutput）
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';
import { getBashJobStore } from '../services/bash-jobs/index.js';

export function registerBashOutputTools(registry: {
  register: (t: ToolDefinition) => void;
}): void {
  registry.register({
    name: 'BashOutput',
    description:
      'Read stdout/stderr from a background Bash job by bash_id. Pass prior offsets to get only new output.',
    inputSchema: {
      type: 'object',
      properties: {
        bash_id: { type: 'string', description: 'Id from Bash run_in_background' },
        stdout_offset: {
          type: 'number',
          description: 'Prior stdoutOffset from last BashOutput (default 0)',
        },
        stderr_offset: {
          type: 'number',
          description: 'Prior stderrOffset from last BashOutput (default 0)',
        },
      },
      required: ['bash_id'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const {
        bash_id: bashId,
        stdout_offset: stdoutOffset,
        stderr_offset: stderrOffset,
      } = input as {
        bash_id: string;
        stdout_offset?: number;
        stderr_offset?: number;
      };
      const result = getBashJobStore().readOutput(bashId, {
        stdoutOffset,
        stderrOffset,
      });
      if ('error' in result && !('id' in result)) {
        return {
          content: [{ type: 'text', text: result.error }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  });

  registry.register({
    name: 'BashStop',
    description: 'Request stop of a running background Bash job.',
    inputSchema: {
      type: 'object',
      properties: {
        bash_id: { type: 'string' },
      },
      required: ['bash_id'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const { bash_id: bashId } = input as { bash_id: string };
      const result = getBashJobStore().requestStop(bashId);
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
            text: JSON.stringify({ bash_id: bashId, stop_requested: true }, null, 2),
          },
        ],
      };
    },
  });
}
