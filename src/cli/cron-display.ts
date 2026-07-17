/**
 * /cron 纯文本处理 — REPL / TUI 共用（进程内 store，无 OS daemon）
 */

import {
  getCronStore,
  type CronJob,
  type CronStore,
} from '../services/cron/index.js';

export function formatCronLines(args: string[], store: CronStore = getCronStore()): string[] {
  const sub = args[0] ?? 'list';

  if (sub === 'list' || args.length === 0) {
    return [JSON.stringify({ jobs: store.list() }, null, 2)];
  }

  if (sub === 'create') {
    const expression = args[1];
    const prompt = args.slice(2).join(' ').trim();
    if (!expression || !prompt) {
      return ['Usage: /cron create <every:5m|@hourly> <prompt…>'];
    }
    try {
      const job = store.create({ expression, prompt });
      return [`Scheduled ${job.id} next=${new Date(job.nextRunAt).toISOString()}`];
    } catch (e) {
      return [e instanceof Error ? e.message : String(e)];
    }
  }

  if (sub === 'delete') {
    const id = args[1];
    if (!id) return ['Usage: /cron delete <job_id>'];
    return store.delete(id) ? [`Deleted ${id}`] : [`Unknown job ${id}`];
  }

  if (sub === 'due') {
    const jobs: CronJob[] = store.due();
    return [JSON.stringify({ due_count: jobs.length, jobs }, null, 2)];
  }

  return ['Usage: /cron [list|create|delete|due]'];
}
