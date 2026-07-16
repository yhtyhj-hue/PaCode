/**
 * Bash Tool - shell execution with security checks
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';
import { createSecureBashExecutor } from './bash-secure.js';

const secureBash = createSecureBashExecutor({ timeoutMs: 60000 });

export function registerBashTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'Bash',
    description: 'Execute shell commands',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const { command } = input as { command: string };
      const { stdout, stderr, exitCode, truncated } = await secureBash(command);

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
