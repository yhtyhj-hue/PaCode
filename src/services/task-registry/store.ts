/**
 * J1: Task 运行时登记 — 结果可见 + Stop 目标
 */

import type { SubagentReport } from '../../agent/subagent.js';
import type { TaskListItem, TrackedTask, TrackedTaskStatus } from './types.js';

const MAX_TASKS = 100;

export class TaskStore {
  private tasks = new Map<string, TrackedTask>();
  private abortFns = new Map<string, () => void>();
  private seq = 0;

  createId(): string {
    this.seq += 1;
    return `task_${Date.now().toString(36)}_${this.seq}`;
  }

  begin(input: {
    id?: string;
    description: string;
    subagentType: string;
    background: boolean;
    abort?: () => void;
  }): TrackedTask {
    const id = input.id ?? this.createId();
    const task: TrackedTask = {
      id,
      description: input.description,
      subagentType: input.subagentType,
      status: 'running',
      startedAt: Date.now(),
      background: input.background,
    };
    this.tasks.set(id, task);
    if (input.abort) this.abortFns.set(id, input.abort);
    this.trim();
    return task;
  }

  complete(id: string, data: { report: SubagentReport; output: string }): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = data.report.success ? 'done' : 'error';
    task.endedAt = Date.now();
    task.report = data.report;
    task.output = data.output;
    task.error = data.report.error;
    this.abortFns.delete(id);
  }

  fail(id: string, error: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'error';
    task.endedAt = Date.now();
    task.error = error;
    this.abortFns.delete(id);
  }

  markStopped(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'stopped';
    task.endedAt = Date.now();
    this.abortFns.delete(id);
  }

  /** 请求中止；返回是否找到可中止的 running task */
  requestStop(id: string): { ok: boolean; reason?: string; status?: TrackedTaskStatus } {
    const task = this.tasks.get(id);
    if (!task) return { ok: false, reason: `Unknown task id: ${id}` };
    if (task.status !== 'running') {
      return { ok: false, reason: `Task ${id} is already ${task.status}`, status: task.status };
    }
    const abort = this.abortFns.get(id);
    if (!abort) {
      return {
        ok: false,
        reason: `Task ${id} has no abort handle (sync tasks finish before Stop can run)`,
        status: task.status,
      };
    }
    abort();
    return { ok: true, status: 'running' };
  }

  get(id: string): TrackedTask | undefined {
    return this.tasks.get(id);
  }

  list(): TaskListItem[] {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(({ id, description, subagentType, status, startedAt, endedAt, background }) => ({
        id,
        description,
        subagentType,
        status,
        startedAt,
        endedAt,
        background,
      }));
  }

  clear(): void {
    this.tasks.clear();
    this.abortFns.clear();
    this.seq = 0;
  }

  private trim(): void {
    if (this.tasks.size <= MAX_TASKS) return;
    const sorted = Array.from(this.tasks.values()).sort((a, b) => a.startedAt - b.startedAt);
    const drop = sorted.slice(0, this.tasks.size - MAX_TASKS);
    for (const t of drop) {
      if (t.status === 'running') continue;
      this.tasks.delete(t.id);
      this.abortFns.delete(t.id);
    }
  }
}

let instance: TaskStore | null = null;

export function getTaskStore(): TaskStore {
  if (!instance) instance = new TaskStore();
  return instance;
}

export function resetTaskStore(): void {
  instance = null;
}
