/**
 * Bash Tool - shell execution with security checks
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';
import { createSecureBashExecutor } from './bash-secure.js';

const secureBash = createSecureBashExecutor(60000);

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
      const { stdout, stderr, exitCode } = await secureBash(command);

      if (exitCode !== 0) {
        return {
          content: [{ type: 'text', text: stderr || stdout || 'Command failed' }],
          isError: true,
        };
      }

      return { content: [{ type: 'text', text: stdout || stderr }] };
    },
  });
}
