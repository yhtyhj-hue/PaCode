/**
 * K4: 进程内 cron 任务存储（无 OS daemon）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface CronJob {
  id: string;
  /** every:5m | every:1h | @hourly | @daily */
  expression: string;
  prompt: string;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt?: number;
  createdAt: number;
}

export interface CronStoreFile {
  jobs: CronJob[];
}

const MAX_JOBS = 50;
/** 最短调度间隔：防止 every:1ms 刷爆会话 */
export const MIN_CRON_INTERVAL_MS = 60_000;
export const MAX_CRON_PROMPT_CHARS = 4000;
/** 单轮最多注入的到期任务数 */
export const MAX_CRON_DUE_PER_TURN = 5;

export function defaultCronPath(cwd: string = process.cwd()): string {
  return join(cwd, '.paude', 'cron.json');
}

/** 清洗 cron prompt：去控制字符、截断，降低注入噪音 */
export function sanitizeCronPrompt(prompt: string): string {
  // eslint-disable-next-line no-control-regex -- 刻意剥离 C0 控制字符
  const cleaned = prompt.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  if (cleaned.length <= MAX_CRON_PROMPT_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_CRON_PROMPT_CHARS)}\n…[truncated]`;
}

/** 解析简单表达式，返回间隔毫秒；失败返回 null */
export function parseScheduleIntervalMs(expression: string): number | null {
  const expr = expression.trim().toLowerCase();
  if (expr === '@hourly') return 60 * 60 * 1000;
  if (expr === '@daily') return 24 * 60 * 60 * 1000;
  const m = expr.match(/^every:(\d+)(ms|s|m|h)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]!;
  let ms: number;
  if (unit === 'ms') ms = n;
  else if (unit === 's') ms = n * 1000;
  else if (unit === 'm') ms = n * 60 * 1000;
  else if (unit === 'h') ms = n * 60 * 60 * 1000;
  else return null;
  if (ms < MIN_CRON_INTERVAL_MS) return null;
  return ms;
}

export function computeNextRunAt(expression: string, fromMs: number = Date.now()): number | null {
  const interval = parseScheduleIntervalMs(expression);
  if (interval === null) return null;
  return fromMs + interval;
}

export class CronStore {
  private path: string;
  private jobs = new Map<string, CronJob>();
  private seq = 0;

  constructor(path?: string) {
    this.path = path ?? defaultCronPath();
    this.load();
  }

  list(): CronJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => a.nextRunAt - b.nextRunAt);
  }

  get(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  create(input: { expression: string; prompt: string; now?: number }): CronJob {
    if (this.jobs.size >= MAX_JOBS) {
      throw new Error(`Max ${MAX_JOBS} cron jobs`);
    }
    const prompt = sanitizeCronPrompt(input.prompt);
    if (!prompt) throw new Error('prompt required');
    const now = input.now ?? Date.now();
    const nextRunAt = computeNextRunAt(input.expression, now);
    if (nextRunAt === null) {
      throw new Error(
        `Unsupported expression: ${input.expression}. Use every:5m|1h|@hourly|@daily (min interval ${MIN_CRON_INTERVAL_MS / 1000}s)`
      );
    }
    this.seq += 1;
    const job: CronJob = {
      id: `cron_${now.toString(36)}_${this.seq}`,
      expression: input.expression.trim(),
      prompt,
      enabled: true,
      nextRunAt,
      createdAt: now,
    };
    this.jobs.set(job.id, job);
    this.persist();
    return job;
  }

  delete(id: string): boolean {
    const ok = this.jobs.delete(id);
    if (ok) this.persist();
    return ok;
  }

  /** 返回到期任务并推进 nextRunAt（每个 job 最多一次） */
  due(now: number = Date.now()): CronJob[] {
    const fired: CronJob[] = [];
    for (const job of this.jobs.values()) {
      if (!job.enabled || job.nextRunAt > now) continue;
      const interval = parseScheduleIntervalMs(job.expression);
      if (interval === null) continue;
      job.lastRunAt = now;
      job.nextRunAt = now + interval;
      fired.push({ ...job });
    }
    if (fired.length > 0) this.persist();
    return fired;
  }

  clear(): void {
    this.jobs.clear();
    this.persist();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf-8')) as CronStoreFile;
      for (const job of raw.jobs ?? []) {
        this.jobs.set(job.id, job);
      }
    } catch {
      /* corrupt file → empty */
    }
  }

  private persist(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file: CronStoreFile = { jobs: this.list() };
    writeFileSync(this.path, JSON.stringify(file, null, 2), 'utf-8');
  }
}

let instance: CronStore | null = null;

export function getCronStore(path?: string): CronStore {
  if (!instance || path) {
    instance = new CronStore(path);
  }
  return instance;
}

export function resetCronStore(): void {
  instance = null;
}
