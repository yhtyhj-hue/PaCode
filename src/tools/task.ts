/**
 * Task Tool - Subagent delegation via SubagentManager
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';
import { ToolRegistry } from './registry.js';
import { getSubagentManager } from '../agent/subagent.js';

export interface TaskToolDeps {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  toolRegistry: ToolRegistry;
}

export function registerTaskTool(
  registry: { register: (t: ToolDefinition) => void },
  deps: TaskToolDeps
) {
  registry.register({
    name: 'Task',
    description: 'Delegate a task to a specialized subagent',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Short task description' },
        prompt: { type: 'string', description: 'Detailed task for the subagent' },
        subagent_type: {
          type: 'string',
          description: 'Subagent type: general-purpose, explore, or plan',
        },
      },
      required: ['description', 'prompt'],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const {
        prompt,
        description,
        subagent_type: subagentType = 'general-purpose',
      } = input as {
        prompt: string;
        description: string;
        subagent_type?: string;
      };

      const manager = getSubagentManager();
      const config = manager.get(subagentType);

      if (!config) {
        return {
          content: [
            {
              type: 'text',
              text: `Unknown subagent type: ${subagentType}. Available: ${manager
                .list()
                .map((a) => a.name)
                .join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      const result = await manager.run(config, `${description}\n\n${prompt}`, {
        apiKey: deps.apiKey,
        baseUrl: deps.baseUrl,
        model: deps.model,
        toolRegistry: deps.toolRegistry,
      });

      if (!result.success) {
        return {
          content: [{ type: 'text', text: result.output || result.error || 'Subagent failed' }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `[Subagent: ${result.name}] (${result.duration}ms, ${result.toolCalls} tools)\n\n${result.output}`,
          },
        ],
      };
    },
  });
}
