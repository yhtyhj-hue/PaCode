/**
 * Task Tool - Subagent delegation
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';

export function registerTaskTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'Task',
    description: 'Delegate a task to a subagent',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string' },
      },
      required: ['prompt'],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const { prompt, model = 'sonnet' } = input as { prompt: string; model?: string };
      return {
        content: [{ type: 'text', text: `[Subagent] Task delegated to ${model}: ${prompt}` }],
      };
    },
  });
}
