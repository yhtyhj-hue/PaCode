/**
 * Glob Tool
 */

import { glob } from 'glob';
import { resolve } from 'node:path';
import { ToolDefinition, PermissionMode } from '../pkg/types.js';

export function registerGlobTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'Glob',
    description: 'Find files matching pattern',
    inputSchema: {
      type: 'object',
      properties: { pattern: { type: 'string' }, cwd: { type: 'string' } },
      required: ['pattern'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const { pattern, cwd = '.' } = input as { pattern: string; cwd?: string };
      try {
        const files = await glob(pattern, { cwd: resolve(cwd) });
        return { content: [{ type: 'text', text: files.join('\n') }] };
      } catch (e) {
        return { content: [{ type: 'text', text: String(e) }], isError: true };
      }
    },
  });
}
