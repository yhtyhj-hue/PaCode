/**
 * TodoWrite Tool - Task list management
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  created: number;
}

export function registerTodoWriteTool(registry: { register: (t: ToolDefinition) => void }) {
  const todos = new Map<string, TodoItem>();

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
    async execute(input) {
      const { action, id, content, status } = input as {
        action: string;
        id?: string;
        content?: string;
        status?: string;
      };

      switch (action) {
        case 'create':
          if (!content)
            return { content: [{ type: 'text', text: 'Content required' }], isError: true };
          const newId = `todo-${Date.now()}`;
          todos.set(newId, { content, status: 'pending', created: Date.now() });
          return { content: [{ type: 'text', text: `Created: ${newId}` }] };

        case 'update':
          if (!id || !status)
            return { content: [{ type: 'text', text: 'ID and status required' }], isError: true };
          const todo = todos.get(id);
          if (!todo)
            return { content: [{ type: 'text', text: `Not found: ${id}` }], isError: true };
          todo.status = status as TodoItem['status'];
          return { content: [{ type: 'text', text: `Updated: ${id}` }] };

        case 'list':
          const list = Array.from(todos.entries())
            .map(([k, v]) => `[${v.status}] ${k}: ${v.content}`)
            .join('\n');
          return { content: [{ type: 'text', text: list || 'No tasks' }] };

        case 'delete':
          if (!id) return { content: [{ type: 'text', text: 'ID required' }], isError: true };
          todos.delete(id);
          return { content: [{ type: 'text', text: `Deleted: ${id}` }] };

        default:
          return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
      }
    },
  });
}
