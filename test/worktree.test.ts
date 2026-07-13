/**
 * Worktree manager + CLI handler tests (D3)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseWorktreePorcelain,
  validateWorktreeName,
  WorktreeManager,
  resetWorktreeManager,
} from '../src/cli/worktree.js';
import { handleWorktree } from '../src/cli/handlers.js';
import { resolveCliRoute } from '../src/cli/args.js';

const samplePorcelain = `worktree /Users/dev/myapp
HEAD abc123def456
branch refs/heads/main

worktree /Users/dev/myapp/.claude/worktrees/feature-a
HEAD fedcba987654
branch refs/heads/feature-a

worktree /Users/dev/myapp/.claude/worktrees/detached-wt
HEAD 111222333444
detached
`;

describe('validateWorktreeName', () => {
  it('accepts safe names', () => {
    expect(validateWorktreeName('feature-a')).toBe(true);
    expect(validateWorktreeName('fix_123')).toBe(true);
  });

  it('rejects unsafe names', () => {
    expect(validateWorktreeName('')).toBe(false);
    expect(validateWorktreeName('../escape')).toBe(false);
    expect(validateWorktreeName('a b')).toBe(false);
    expect(validateWorktreeName('rm -rf')).toBe(false);
  });
});

describe('parseWorktreePorcelain', () => {
  it('parses branches and detached HEAD', () => {
    const items = parseWorktreePorcelain(samplePorcelain, '/Users/dev/myapp');
    expect(items).toHaveLength(3);
    expect(items[0]?.isMain).toBe(true);
    expect(items[0]?.branch).toBe('main');
    expect(items[1]?.name).toBe('feature-a');
    expect(items[1]?.branch).toBe('feature-a');
    expect(items[2]?.branch).toBe('(detached)');
  });
});

describe('WorktreeManager — read-only', () => {
  it('detects git repo in PaCode workspace', () => {
    const wt = new WorktreeManager(process.cwd());
    expect(wt.isGitRepo()).toBe(true);
  });

  it('lists at least the main worktree', () => {
    const wt = new WorktreeManager(process.cwd());
    if (!wt.isGitRepo()) return;
    const items = wt.list();
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((w) => w.isMain)).toBe(true);
  });

  it('rejects invalid names on create', () => {
    const wt = new WorktreeManager(process.cwd());
    expect(wt.create('../bad')).toBeNull();
  });
});

describe('handleWorktree', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    resetWorktreeManager();
  });

  it('lists worktrees via mock service', async () => {
    await handleWorktree(['list'], {
      worktree: {
        isGitRepo: () => true,
        list: () => [
          { name: 'myapp', path: '/repo', branch: 'main', isMain: true },
          { name: 'feat', path: '/repo/.claude/worktrees/feat', branch: 'feat', isMain: false },
        ],
        create: vi.fn(),
        remove: vi.fn(),
      },
    });

    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Git Worktrees'))).toBe(true);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('feat'))).toBe(true);
  });

  it('creates worktree via mock service', async () => {
    const create = vi.fn(() => ({
      name: 'parallel-1',
      path: '/repo/.claude/worktrees/parallel-1',
      branch: 'parallel-1',
      isMain: false,
    }));

    await handleWorktree(['create', 'parallel-1', 'main'], {
      worktree: { isGitRepo: () => true, list: () => [], create, remove: vi.fn() },
    });

    expect(create).toHaveBeenCalledWith('parallel-1', 'main');
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Created worktree'))).toBe(true);
  });

  it('exits when create fails', async () => {
    const exit = vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    }) as (code: number) => never;

    await expect(
      handleWorktree(['create', 'fail'], {
        worktree: {
          isGitRepo: () => true,
          list: () => [],
          create: () => null,
          remove: vi.fn(),
        },
        exit,
      })
    ).rejects.toThrow('exit:1');
  });

  it('removes worktree via mock service', async () => {
    const remove = vi.fn(() => true);
    await handleWorktree(['remove', 'parallel-1'], {
      worktree: { isGitRepo: () => true, list: () => [], create: vi.fn(), remove },
    });
    expect(remove).toHaveBeenCalledWith('parallel-1');
  });

  it('exits when not a git repo on list', async () => {
    const exit = vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    }) as (code: number) => never;

    await expect(
      handleWorktree(['list'], {
        worktree: { isGitRepo: () => false, list: () => [], create: vi.fn(), remove: vi.fn() },
        exit,
      })
    ).rejects.toThrow('exit:1');
  });
});

describe('resolveCliRoute — worktree', () => {
  it('routes worktree subcommand', () => {
    expect(resolveCliRoute(['worktree', 'list'], {})).toBe('worktree');
    expect(resolveCliRoute(['wt', 'create', 'a'], {})).toBe('worktree');
  });
});
