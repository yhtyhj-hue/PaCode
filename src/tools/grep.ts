/**
 * Grep Tool
 */

import { exec } from 'node:child_process';
import { ToolDefinition, PermissionMode } from '../pkg/types.js';

export function registerGrepTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'Grep',
    description: 'Search for pattern in files using ripgrep',
    inputSchema: {
      type: 'object',
      properties: { pattern: { type: 'string' }, path: { type: 'string' } },
      required: ['pattern'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const { pattern, path = '.' } = input as { pattern: string; path?: string };
      return new Promise((resolve) => {
        exec(`rg "${pattern}" ${path}`, { timeout: 30000 }, (err, stdout, stderr) => {
          if (err && !stdout) {
            resolve({ content: [{ type: 'text', text: stderr || 'No matches' }] });
          } else {
            resolve({ content: [{ type: 'text', text: stdout || stderr }] });
          }
        });
      });
    },
  });
}
