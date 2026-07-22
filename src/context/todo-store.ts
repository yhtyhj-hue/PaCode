/**
 * Session-scoped todo store — Task Context source
 */

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  created: number;
}

class TodoStore {
  private sessions = new Map<string, Map<string, TodoItem>>();

  private getSessionMap(sessionId: string): Map<string, TodoItem> {
    let map = this.sessions.get(sessionId);
    if (!map) {
      map = new Map();
      this.sessions.set(sessionId, map);
    }
    return map;
  }

  create(sessionId: string, content: string): string {
    const id = `todo-${Date.now()}`;
    this.getSessionMap(sessionId).set(id, {
      id,
      content,
      status: 'pending',
      created: Date.now(),
    });
    return id;
  }

  update(sessionId: string, id: string, status: TodoItem['status']): boolean {
    const todo = this.getSessionMap(sessionId).get(id);
    if (!todo) return false;
    todo.status = status;
    return true;
  }

  delete(sessionId: string, id: string): boolean {
    return this.getSessionMap(sessionId).delete(id);
  }

  list(sessionId: string): TodoItem[] {
    return Array.from(this.getSessionMap(sessionId).values());
  }

  /**
   * CC 风格整表替换 — 一次写入完整任务列表，驱动 REPL 实时任务树
   */
  replaceAll(
    sessionId: string,
    todos: Array<{ content: string; status?: TodoItem['status']; id?: string }>
  ): TodoItem[] {
    const map = new Map<string, TodoItem>();
    const now = Date.now();
    todos.forEach((t, i) => {
      const id = t.id?.trim() || `todo-${now}-${i}`;
      map.set(id, {
        id,
        content: t.content,
        status: t.status ?? 'pending',
        created: now + i,
      });
    });
    this.sessions.set(sessionId, map);
    return Array.from(map.values());
  }

  formatForContext(sessionId: string): string | null {
    const items = this.list(sessionId);
    if (items.length === 0) return null;
    return items.map((t) => `[${t.status}] ${t.id}: ${t.content}`).join('\n');
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

let instance: TodoStore | null = null;
export function getTodoStore(): TodoStore {
  if (!instance) instance = new TodoStore();
  return instance;
}

export function resetTodoStore(): void {
  instance = null;
}
