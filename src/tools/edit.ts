/**
 * Edit Tool
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';
import { resolvePathInWorkspace } from './path-utils.js';

export function registerEditTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'Edit',
    description: 'Edit file with replacement',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldText: { type: 'string' },
        newText: { type: 'string' },
      },
      required: ['path', 'oldText', 'newText'],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.ACCEPT_EDITS,
    async execute(input, ctx?: ToolContext) {
      const { path, oldText, newText } = input as {
        path: string;
        oldText: string;
        newText: string;
      };
      const root = ctx?.workingDirectory ?? process.cwd();
      const resolved = resolvePathInWorkspace(path, root);
      if (!resolved.ok) {
        return { content: [{ type: 'text', text: resolved.reason }], isError: true };
      }
      try {
        let content = readFileSync(resolved.resolved, 'utf-8');
        if (!content.includes(oldText)) {
          return { content: [{ type: 'text', text: 'Text not found' }], isError: true };
        }
        content = content.replace(oldText, newText);
        writeFileSync(resolved.resolved, content, 'utf-8');
        return { content: [{ type: 'text', text: `Edited ${path}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: String(e) }], isError: true };
      }
    },
  });
}
