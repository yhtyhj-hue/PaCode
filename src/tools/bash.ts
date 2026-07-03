/**
 * Bash Tool
 */

import { exec } from 'node:child_process';
import { ToolDefinition, PermissionMode } from '../pkg/types.js';

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
    permissionMode: PermissionMode.BYPASS,
    async execute(input) {
      const { command } = input as { command: string };
      return new Promise((resolve) => {
        exec(command, { timeout: 60000 }, (err, stdout, stderr) => {
          if (err) {
            resolve({ content: [{ type: 'text', text: stderr || err.message }], isError: true });
          } else {
            resolve({ content: [{ type: 'text', text: stdout || stderr }] });
          }
        });
      });
    },
  });
}
