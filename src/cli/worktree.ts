/**
 * Worktree Isolation — git worktree management for parallel sessions
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger } from '../pkg/logger/index.js';

export interface Worktree {
  name: string;
  path: string;
  branch: string;
  isMain: boolean;
}

/** 校验 worktree / 分支名，防止 shell 注入与路径逃逸 */
export function validateWorktreeName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);
}

/** 解析 `git worktree list --porcelain` 输出 */
export function parseWorktreePorcelain(output: string, repoRoot: string): Worktree[] {
  const normalizedRoot = resolve(repoRoot);
  const worktrees: Worktree[] = [];
  let path = '';
  let branch = '';

  const flush = (): void => {
    if (!path) return;
    worktrees.push({
      name: path.split('/').pop() ?? path,
      path,
      branch: branch || '(unknown)',
      isMain: resolve(path) === normalizedRoot,
    });
    path = '';
    branch = '';
  };

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('worktree ')) {
      flush();
      path = trimmed.slice('worktree '.length);
    } else if (trimmed.startsWith('branch refs/heads/')) {
      branch = trimmed.slice('branch refs/heads/'.length);
    } else if (trimmed.startsWith('branch ')) {
      branch = trimmed.slice('branch '.length);
    } else if (trimmed === 'detached') {
      branch = '(detached)';
    }
  }
  flush();

  return worktrees;
}

export class WorktreeManager {
  private log: Logger;
  private worktreesDir: string;
  private repoRoot: string;

  constructor(repoRoot?: string) {
    this.log = new Logger({ prefix: 'Worktree' });
    this.repoRoot = resolve(repoRoot ?? process.cwd());
    this.worktreesDir = join(this.repoRoot, '.claude', 'worktrees');
  }

  getRepoRoot(): string {
    return this.repoRoot;
  }

  getWorktreesDir(): string {
    return this.worktreesDir;
  }

  isGitRepo(): boolean {
    try {
      execFileSync('git', ['rev-parse', '--git-dir'], { cwd: this.repoRoot, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  list(): Worktree[] {
    if (!this.isGitRepo()) return [];
    try {
      const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: this.repoRoot,
        encoding: 'utf-8',
      });
      return parseWorktreePorcelain(output, this.repoRoot);
    } catch {
      return [];
    }
  }

  create(name: string, baseBranch?: string): Worktree | null {
    if (!validateWorktreeName(name)) {
      this.log.error(`Invalid worktree name: ${name}`);
      return null;
    }
    if (!this.isGitRepo()) {
      this.log.warn('Not a git repository');
      return null;
    }

    if (!existsSync(this.worktreesDir)) mkdirSync(this.worktreesDir, { recursive: true });
    const worktreePath = join(this.worktreesDir, name);

    try {
      const base = baseBranch ?? 'HEAD';
      execFileSync(
        'git',
        ['worktree', 'add', '-b', name, worktreePath, base],
        { cwd: this.repoRoot, stdio: 'ignore' }
      );
      this.log.info(`Created worktree: ${name}`);
      return { name, path: worktreePath, branch: name, isMain: false };
    } catch (e) {
      this.log.error(`Failed to create worktree: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** I6: 为 Subagent 创建唯一 ephemeral worktree（不 chdir，调用方传 path 给工具） */
  createEphemeral(prefix = 'pacode-sub'): Worktree | null {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const raw = `${prefix}-${stamp}`.replace(/[^a-zA-Z0-9._-]/g, '-');
    const name = raw.slice(0, 64);
    if (!validateWorktreeName(name)) return null;
    return this.create(name);
  }

  remove(name: string, options: { deleteBranch?: boolean } = {}): boolean {
    if (!validateWorktreeName(name)) {
      this.log.error(`Invalid worktree name: ${name}`);
      return false;
    }
    if (!this.isGitRepo()) return false;

    const worktreePath = join(this.worktreesDir, name);
    try {
      execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], {
        cwd: this.repoRoot,
        stdio: 'ignore',
      });
    } catch {
      try {
        if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true });
      } catch {
        return false;
      }
    }

    // ephemeral 分支默认删除，避免 .claude/worktrees 堆积孤儿分支
    if (options.deleteBranch !== false && name.startsWith('pacode-sub-')) {
      try {
        execFileSync('git', ['branch', '-D', name], {
          cwd: this.repoRoot,
          stdio: 'ignore',
        });
      } catch {
        /* branch may already be gone */
      }
    }
    return true;
  }

  runInWorktree<T>(worktreeName: string, fn: () => T): T {
    const worktreePath = join(this.worktreesDir, worktreeName);
    if (!existsSync(worktreePath)) throw new Error(`Worktree not found: ${worktreeName}`);
    const originalCwd = process.cwd();
    try {
      process.chdir(worktreePath);
      return fn();
    } finally {
      process.chdir(originalCwd);
    }
  }
}

let instance: WorktreeManager | null = null;

export function getWorktreeManager(repoRoot?: string): WorktreeManager {
  if (!instance || repoRoot) {
    instance = new WorktreeManager(repoRoot);
  }
  return instance;
}

export function resetWorktreeManager(): void {
  instance = null;
}
