/**
 * TodoWrite Tool - Task list management (session-scoped)
 */

import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';
import { getTodoStore } from '../context/todo-store.js';

function sessionIdFrom(ctx: ToolContext): string {
  return ctx.sessionState?.sessionId ?? 'default';
}

export function registerTodoWriteTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'TodoWrite',
    description: 'Manage task list',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'list', 'delete'] },
        id: { type: 'string' },
        content: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
      },
      required: ['action'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input, ctx) {
      const { action, id, content, status } = input as {
        action: string;
        id?: string;
        content?: string;
        status?: string;
      };

      const sessionId = sessionIdFrom(ctx);
      const store = getTodoStore();

      switch (action) {
        case 'create': {
          if (!content)
            return { content: [{ type: 'text', text: 'Content required' }], isError: true };
          const newId = store.create(sessionId, content);
          return { content: [{ type: 'text', text: `Created: ${newId}` }] };
        }

        case 'update':
          if (!id || !status)
            return { content: [{ type: 'text', text: 'ID and status required' }], isError: true };
          if (!store.update(sessionId, id, status as 'pending' | 'in_progress' | 'completed'))
            return { content: [{ type: 'text', text: `Not found: ${id}` }], isError: true };
          return { content: [{ type: 'text', text: `Updated: ${id}` }] };

        case 'list': {
          const list = store
            .list(sessionId)
            .map((t) => `[${t.status}] ${t.id}: ${t.content}`)
            .join('\n');
          return { content: [{ type: 'text', text: list || 'No tasks' }] };
        }

        case 'delete':
          if (!id) return { content: [{ type: 'text', text: 'ID required' }], isError: true };
          store.delete(sessionId, id);
          return { content: [{ type: 'text', text: `Deleted: ${id}` }] };

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    },
  });
}
