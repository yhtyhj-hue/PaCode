/**
 * Read Tool
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToolDefinition, PermissionMode } from '../pkg/types.js';

export function registerReadTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'Read',
    description: 'Read file contents',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, limit: { type: 'number' } },
      required: ['path'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const { path, limit } = input as { path: string; limit?: number };
      try {
        let content = readFileSync(resolve(path), 'utf-8');
        if (limit) content = content.split('\n').slice(0, limit).join('\n');
        return { content: [{ type: 'text', text: content }] };
      } catch (e) {
        return { content: [{ type: 'text', text: String(e) }], isError: true };
      }
    },
  });
}
