/**
 * Background Bash jobs — CC BashOutput 对标（spawn 进程，非 shell &）
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { checkBashSecurity, shouldHardBlockBashExecution } from '../../tools/bash-secure.js';

const MAX_JOBS = 50;
const MAX_BUFFER_CHARS = 200_000;

export type BashJobStatus = 'running' | 'done' | 'error' | 'stopped';

export interface BashJob {
  id: string;
  command: string;
  cwd: string;
  status: BashJobStatus;
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface BashJobListItem {
  id: string;
  command: string;
  status: BashJobStatus;
  startedAt: number;
  endedAt?: number;
}

function appendCapped(prev: string, chunk: string): string {
  const next = prev + chunk;
  if (next.length <= MAX_BUFFER_CHARS) return next;
  return next.slice(next.length - MAX_BUFFER_CHARS);
}

export class BashJobStore {
  private jobs = new Map<string, BashJob>();
  private children = new Map<string, ChildProcessWithoutNullStreams>();
  private seq = 0;

  createId(): string {
    this.seq += 1;
    return `bash_${Date.now().toString(36)}_${this.seq}`;
  }

  /** 安全检查后后台启动；硬拒返回 error 字符串 */
  start(command: string, cwd: string = process.cwd()): { job: BashJob } | { error: string } {
    const security = checkBashSecurity(command);
    if (shouldHardBlockBashExecution(security)) {
      return { error: security.reason ?? 'Blocked' };
    }

    const id = this.createId();
    const job: BashJob = {
      id,
      command,
      cwd,
      status: 'running',
      startedAt: Date.now(),
      stdout: '',
      stderr: '',
    };
    this.jobs.set(id, job);
    this.trim();

    // 核心：用 spawn(shell) 而非 trailing &，便于 Abort + BashOutput 轮询
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
    });
    this.children.set(id, child);

    child.stdout.on('data', (buf: Buffer) => {
      job.stdout = appendCapped(job.stdout, buf.toString('utf-8'));
    });
    child.stderr.on('data', (buf: Buffer) => {
      job.stderr = appendCapped(job.stderr, buf.toString('utf-8'));
    });
    child.on('error', (err) => {
      job.status = 'error';
      job.error = err.message;
      job.endedAt = Date.now();
      this.children.delete(id);
    });
    child.on('close', (code) => {
      if (job.status === 'stopped') {
        job.endedAt = Date.now();
        this.children.delete(id);
        return;
      }
      job.exitCode = code ?? 1;
      job.status = code === 0 ? 'done' : 'error';
      if (code !== 0 && !job.error) {
        job.error = `exit ${code ?? 1}`;
      }
      job.endedAt = Date.now();
      this.children.delete(id);
    });

    return { job };
  }

  get(id: string): BashJob | undefined {
    return this.jobs.get(id);
  }

  list(): BashJobListItem[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(({ id, command, status, startedAt, endedAt }) => ({
        id,
        command,
        status,
        startedAt,
        endedAt,
      }));
  }

  /** 读取输出切片；offset 为已消费字符数（stdout+stderr 合并视图用 stdoutOffset） */
  readOutput(
    id: string,
    options: { stdoutOffset?: number; stderrOffset?: number } = {}
  ):
    | {
        id: string;
        status: BashJobStatus;
        exitCode?: number;
        stdout: string;
        stderr: string;
        stdoutOffset: number;
        stderrOffset: number;
        error?: string;
      }
    | { error: string } {
    const job = this.jobs.get(id);
    if (!job) return { error: `Unknown bash_id: ${id}` };
    const so = Math.max(0, options.stdoutOffset ?? 0);
    const eo = Math.max(0, options.stderrOffset ?? 0);
    return {
      id: job.id,
      status: job.status,
      exitCode: job.exitCode,
      stdout: job.stdout.slice(so),
      stderr: job.stderr.slice(eo),
      stdoutOffset: job.stdout.length,
      stderrOffset: job.stderr.length,
      error: job.error,
    };
  }

  requestStop(id: string): { ok: boolean; reason?: string } {
    const job = this.jobs.get(id);
    if (!job) return { ok: false, reason: `Unknown bash_id: ${id}` };
    if (job.status !== 'running') {
      return { ok: false, reason: `Bash job ${id} is already ${job.status}` };
    }
    const child = this.children.get(id);
    if (!child) {
      return { ok: false, reason: `Bash job ${id} has no process handle` };
    }
    job.status = 'stopped';
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    return { ok: true };
  }

  clear(): void {
    for (const child of this.children.values()) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
    this.jobs.clear();
    this.children.clear();
    this.seq = 0;
  }

  private trim(): void {
    if (this.jobs.size <= MAX_JOBS) return;
    const sorted = Array.from(this.jobs.values()).sort((a, b) => a.startedAt - b.startedAt);
    for (const t of sorted) {
      if (this.jobs.size <= MAX_JOBS) break;
      if (t.status === 'running') continue;
      this.jobs.delete(t.id);
      this.children.delete(t.id);
    }
  }
}

let store: BashJobStore | null = null;

export function getBashJobStore(): BashJobStore {
  if (!store) store = new BashJobStore();
  return store;
}

export function resetBashJobStore(): void {
  store?.clear();
  store = null;
}
