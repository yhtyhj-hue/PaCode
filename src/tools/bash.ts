/**
 * Bash Tool - shell execution with security checks + optional background
 */

import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';
import { createSecureBashExecutor } from './bash-secure.js';
import { getBashJobStore } from '../services/bash-jobs/index.js';

const secureBash = createSecureBashExecutor({ timeoutMs: 60000 });

export function registerBashTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'Bash',
    description:
      'Execute shell commands. Set run_in_background=true for long jobs; then poll with BashOutput (do not use shell &).',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        run_in_background: {
          type: 'boolean',
          description: 'Start as background job; returns bash_id for BashOutput/BashStop',
        },
      },
      required: ['command'],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input, ctx?: ToolContext) {
      const { command, run_in_background: runInBackground = false } = input as {
        command: string;
        run_in_background?: boolean;
      };
      const cwd = ctx?.workingDirectory ?? process.cwd();

      if (runInBackground) {
        const started = getBashJobStore().start(command, cwd);
        if ('error' in started) {
          return {
            content: [{ type: 'text', text: started.error }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  bash_id: started.job.id,
                  status: started.job.status,
                  command: started.job.command,
                  hint: 'Use BashOutput with bash_id to read stdout/stderr; BashStop to abort.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // 核心：在 ToolContext.workingDirectory 执行，支持 Subagent worktree 隔离
      const { stdout, stderr, exitCode, truncated } = await secureBash(command, { cwd });

      const body = stdout || stderr;
      const suffix = truncated
        ? `\n\n[output truncated by PaCode; the original was longer. Use a narrower command or pipe to head/tail/grep to see specific parts.]`
        : '';

      if (exitCode !== 0) {
        return {
          content: [{ type: 'text', text: (stderr || stdout || 'Command failed') + suffix }],
          isError: true,
        };
      }

      return { content: [{ type: 'text', text: body + suffix }] };
    },
  });
}
