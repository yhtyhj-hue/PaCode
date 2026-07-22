/**
 * TodoWrite Tool - Task list management (session-scoped)
 *
 * 兼容 CC：`{ todos: [{ content, status }] }` 整表写入；
 * 同时保留 action=create|update|list|delete。
 */

import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';
import { getTodoStore, TodoItem } from '../context/todo-store.js';

function sessionIdFrom(ctx: ToolContext): string {
  return ctx.sessionState?.sessionId ?? 'default';
}

function formatList(items: TodoItem[]): string {
  if (items.length === 0) return 'No tasks';
  return items.map((t) => `[${t.status}] ${t.id}: ${t.content}`).join('\n');
}

export function registerTodoWriteTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'TodoWrite',
    description:
      'Manage the session task list shown live in the CLI. Prefer writing the full todos array for multi-step work.',
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Full task list (CC-style replace). Each item: content + status.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              id: { type: 'string' },
            },
            required: ['content'],
          },
        },
        action: { type: 'string', enum: ['create', 'update', 'list', 'delete'] },
        id: { type: 'string' },
        content: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
      },
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input, ctx) {
      const { action, id, content, status, todos } = input as {
        action?: string;
        id?: string;
        content?: string;
        status?: string;
        todos?: Array<{ content: string; status?: TodoItem['status']; id?: string }>;
      };

      const sessionId = sessionIdFrom(ctx);
      const store = getTodoStore();

      // CC 主路径：整表替换
      if (Array.isArray(todos)) {
        const list = store.replaceAll(sessionId, todos);
        return {
          content: [
            {
              type: 'text',
              text: `Updated ${list.length} tasks:\n${formatList(list)}`,
            },
          ],
        };
      }

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
          if (!store.update(sessionId, id, status as TodoItem['status']))
            return { content: [{ type: 'text', text: `Not found: ${id}` }], isError: true };
          return { content: [{ type: 'text', text: `Updated: ${id}` }] };

        case 'list': {
          return { content: [{ type: 'text', text: formatList(store.list(sessionId)) }] };
        }

        case 'delete':
          if (!id) return { content: [{ type: 'text', text: 'ID required' }], isError: true };
          store.delete(sessionId, id);
          return { content: [{ type: 'text', text: `Deleted: ${id}` }] };

        default:
          return {
            content: [
              {
                type: 'text',
                text: 'Provide todos:[{content,status}] or action=create|update|list|delete',
              },
            ],
            isError: true,
          };
      }
    },
  });
}
