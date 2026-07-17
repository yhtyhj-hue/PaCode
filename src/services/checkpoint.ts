/**
 * I2: Worktree checkpoint + rewind.
 *
 * Approach: when the engine mutates code (Edit/Write/NotebookEdit),
 * we capture a `git stash` snapshot with a tag like
 *   pacode-checkpoint/<sessionId>/<turnIndex>
 * so the user can later `/rewind <id>` to roll back. Stashes
 * are ephemeral; the user must commit before the session ends
 * if they want permanence (we surface this hint in /rewind
 * output).
 *
 * This is deliberately minimal: it depends on the user already
 * having a clean working tree (otherwise the stash fails with
 * a clear error). We do NOT auto-create a commit on rewind
 * because the user might want to inspect the stash contents
 * first.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CHECKPOINT_PREFIX = 'pacode-checkpoint';

export interface CheckpointMeta {
  /** Combined sessionId/turnIndex; unique within a session. */
  id: string;
  /** Monotonic counter within the session. */
  index: number;
  /** What the user can show via /rewind. */
  label: string;
  /** Capture time (Date.now() at stash time). */
  createdAt: number;
  /** First 60 chars of the stash message. */
  preview: string;
}

/** True iff cwd is inside a git working tree. */
export function isGitRepo(cwd: string = process.cwd()): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a checkpoint for the current working tree. Returns
 * null if the working tree has no changes (no point stashing
 * a clean tree) or if not in a git repo. Returns meta on
 * success.
 */
export function captureCheckpoint(
  sessionId: string,
  index: number,
  label: string,
  cwd: string = process.cwd()
): CheckpointMeta | null {
  if (!isGitRepo(cwd)) {
    return null;
  }
  // Pre-flight: skip stash when there is nothing to save.
  // (git stash push with --include-untracked --keep-index
  //  emits "Saved..." even for a clean tree, so we check
  //  porcelain first.)
  let porcelain: string;
  try {
    porcelain = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      stdio: 'pipe',
    }).toString();
  } catch {
    return null;
  }
  if (porcelain.trim() === '') {
    return null;
  }
  const safeLabel = label.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 60);
  const id = `${sessionId}/${index}`;
  const message = `${CHECKPOINT_PREFIX}/${id} ${safeLabel}`.trim();
  execFileSync(
    'git',
    ['stash', 'push', '-u', '-m', message, '--keep-index', '--include-untracked'],
    { cwd, stdio: 'pipe' }
  );
  return {
    id,
    index,
    label: safeLabel,
    createdAt: Date.now(),
    preview: safeLabel,
  };
}

/**
 * List checkpoints captured by PaCode (filters by stash
 * message prefix). Most-recent first.
 */
export function listCheckpoints(
  cwd: string = process.cwd()
): CheckpointMeta[] {
  if (!isGitRepo(cwd)) return [];
  let raw: string;
  try {
    raw = execFileSync(
      'git',
      ['stash', 'list', '--pretty=format:%gd|%ct|%s'],
      { cwd, stdio: 'pipe' }
    ).toString();
  } catch {
    return [];
  }
  const out: CheckpointMeta[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^stash@\{(\d+)\}\|(\d+)\|(.+)$/);
    if (!m) continue;
    const stashIdx = m[1]!;
    const ts = Number(m[2]) * 1000;
    const subject = m[3] ?? '';
    const idMatch = subject.match(new RegExp(`${CHECKPOINT_PREFIX}/(.+?)\\s+(.*)$`));
    if (!idMatch) continue;
    const id = idMatch[1]!;
    const label = idMatch[2] ?? '';
    const [sessionId, idxStr] = id.split('/');
    out.push({
      id,
      index: Number(idxStr),
      label,
      createdAt: ts,
      preview: label,
    });
    void stashIdx;
    void sessionId;
  }
  return out;
}

/**
 * Restore a checkpoint by id (drops the stash after applying).
 * Returns structured result so REPL can show conflict/dirty-tree hints.
 */
export type RewindResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'not_git'
        | 'not_found'
        | 'apply_failed'
        | 'dirty_conflict';
      message: string;
    };

export function rewindTo(checkpointId: string, cwd: string = process.cwd()): boolean {
  return rewindToDetailed(checkpointId, cwd).ok;
}

export function rewindToDetailed(
  checkpointId: string,
  cwd: string = process.cwd()
): RewindResult {
  if (!isGitRepo(cwd)) {
    return {
      ok: false,
      reason: 'not_git',
      message: 'Not a git repository — checkpoints require git.',
    };
  }
  let raw = '';
  try {
    raw = execFileSync('git', ['stash', 'list', '--pretty=format:%gd'], {
      cwd,
      stdio: 'pipe',
    }).toString();
  } catch {
    return {
      ok: false,
      reason: 'apply_failed',
      message: 'Could not list git stashes.',
    };
  }
  const stashRefs = raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let matched = false;
  for (const ref of stashRefs) {
    let subject: string;
    try {
      subject = execFileSync('git', ['stash', 'show', '-s', '--format=%s', ref], {
        cwd,
        stdio: 'pipe',
      })
        .toString()
        .trim();
    } catch {
      continue;
    }
    if (
      !subject.includes(`${CHECKPOINT_PREFIX}/${checkpointId} `) &&
      !subject.startsWith(`${CHECKPOINT_PREFIX}/${checkpointId}`)
    ) {
      continue;
    }
    matched = true;
    try {
      const stashTreeOut = execFileSync('git', ['rev-parse', `${ref}^{tree}`], {
        cwd,
        stdio: 'pipe',
      })
        .toString()
        .trim();
      execFileSync('git', ['read-tree', '-m', '-u', '--reset', stashTreeOut], {
        cwd,
        stdio: 'pipe',
      });
      execFileSync('git', ['stash', 'drop', ref], { cwd, stdio: 'pipe' });
      return { ok: true };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      // 脏树/冲突：引导用户先 commit 或 stash
      return {
        ok: false,
        reason: /conflict|index|merge|unmerged/i.test(errMsg)
          ? 'dirty_conflict'
          : 'apply_failed',
        message:
          /conflict|index|merge|unmerged/i.test(errMsg)
            ? `Rewind blocked by dirty/conflict tree. Commit or stash your changes, then retry /rewind ${checkpointId}.`
            : `Rewind failed: ${errMsg.slice(0, 200)}`,
      };
    }
  }
  if (!matched) {
    return {
      ok: false,
      reason: 'not_found',
      message: `Checkpoint not found: ${checkpointId}`,
    };
  }
  return {
    ok: false,
    reason: 'apply_failed',
    message: `Rewind failed for ${checkpointId}`,
  };
}

/** Human-readable list of checkpoints for the /rewind slash. */
export function formatCheckpointList(items: CheckpointMeta[]): string {
  if (items.length === 0) {
    return 'No checkpoints available. (Need a git working tree + code-mutating tool calls.)';
  }
  const lines = ['Checkpoints (most recent first):'];
  for (const it of items.slice(0, 10)) {
    const ts = new Date(it.createdAt).toISOString().slice(11, 19);
    lines.push(`  ${ts}  ${it.id}  ${it.label}`);
  }
  if (items.length > 10) {
    lines.push(`  ... and ${items.length - 10} more`);
  }
  return lines.join('\n');
}

void existsSync;
void join;