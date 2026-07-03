/**
 * Edit Tool
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToolDefinition, PermissionMode } from '../pkg/types.js';

export function registerEditTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'Edit',
    description: 'Edit file with replacement',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
      required: ['path', 'oldText', 'newText'],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.ACCEPT_EDITS,
    async execute(input) {
      const { path, oldText, newText } = input as { path: string; oldText: string; newText: string };
      try {
        const fullPath = resolve(path);
        let content = readFileSync(fullPath, 'utf-8');
        if (!content.includes(oldText)) {
          return { content: [{ type: 'text', text: 'Text not found' }], isError: true };
        }
        content = content.replace(oldText, newText);
        writeFileSync(fullPath, content, 'utf-8');
        return { content: [{ type: 'text', text: `Edited ${path}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: String(e) }], isError: true };
      }
    },
  });
}
