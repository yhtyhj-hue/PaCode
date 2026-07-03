/**
 * Write Tool
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToolDefinition, PermissionMode } from '../pkg/types.js';

export function registerWriteTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'Write',
    description: 'Write content to file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.ACCEPT_EDITS,
    async execute(input) {
      const { path, content } = input as { path: string; content: string };
      try {
        writeFileSync(resolve(path), content, 'utf-8');
        return { content: [{ type: 'text', text: `Written to ${path}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: String(e) }], isError: true };
      }
    },
  });
}
