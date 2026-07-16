/**
 * Glob Tool
 */

import { glob } from 'glob';
import { isAbsolute, resolve } from 'node:path';
import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';

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
    async execute(input, ctx?: ToolContext) {
      const { pattern, cwd = '.' } = input as { pattern: string; cwd?: string };
      try {
        const root = ctx?.workingDirectory ?? process.cwd();
        const searchCwd = isAbsolute(cwd) ? cwd : resolve(root, cwd);
        const files = await glob(pattern, { cwd: searchCwd });
        return { content: [{ type: 'text', text: files.join('\n') }] };
      } catch (e) {
        return { content: [{ type: 'text', text: String(e) }], isError: true };
      }
    },
  });
}
