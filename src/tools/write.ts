/**
 * Write Tool
 */

import { writeFileSync } from 'node:fs';
import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';
import { resolvePathInWorkspace } from './path-utils.js';

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
    // DEFAULT：会话可确认后写入；ACCEPT_EDITS 模式由 PermissionSystem 免确认
    permissionMode: PermissionMode.DEFAULT,
    async execute(input, ctx?: ToolContext) {
      const { path, content } = input as { path: string; content: string };
      const root = ctx?.workingDirectory ?? process.cwd();
      const resolved = resolvePathInWorkspace(path, root);
      if (!resolved.ok) {
        return { content: [{ type: 'text', text: resolved.reason }], isError: true };
      }
      try {
        writeFileSync(resolved.resolved, content, 'utf-8');
        return { content: [{ type: 'text', text: `Written to ${path}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: String(e) }], isError: true };
      }
    },
  });
}
