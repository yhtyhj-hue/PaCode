/**
 * Read Tool
 */

import { readFileSync } from 'node:fs';
import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';
import { resolvePathInWorkspace } from './path-utils.js';

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
    async execute(input, ctx?: ToolContext) {
      const { path, limit } = input as { path: string; limit?: number };
      const root = ctx?.workingDirectory ?? process.cwd();
      const resolved = resolvePathInWorkspace(path, root);
      if (!resolved.ok) {
        return { content: [{ type: 'text', text: resolved.reason }], isError: true };
      }
      try {
        let content = readFileSync(resolved.resolved, 'utf-8');
        if (limit) content = content.split('\n').slice(0, limit).join('\n');
        return { content: [{ type: 'text', text: content }] };
      } catch (e) {
        return { content: [{ type: 'text', text: String(e) }], isError: true };
      }
    },
  });
}
