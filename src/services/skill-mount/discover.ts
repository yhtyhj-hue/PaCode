/**
 * Skill Mount — Filesystem discovery
 *
 * Walks one or more roots and returns the absolute paths of every file that
 * matches one of the configured skill filenames (default: SKILL.md).
 *
 * Implementation notes:
 *   - Uses Node's built-in fs.readdir (recursive: true) — no glob dependency.
 *   - Hard caps recursion depth so a misconfigured root cannot blow the stack.
 *   - Skips node_modules / .git by default and any caller-provided dirs.
 *   - Skips dotfiles by default (matches "hidden file" test requirement).
 *   - Errors reading individual entries are skipped, never silently swallowed:
 *     they are returned on the diagnostics array so callers can log them.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import type { PathLike } from 'node:fs';

import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_SKILL_FILENAMES,
  DEFAULT_SKIP_DIRS,
} from './types.js';

export interface DiscoverOptions {
  maxDepth?: number;
  filenames?: readonly string[];
  skipDirs?: readonly string[];
  /** If true, include hidden directories (names starting with `.`). Default false. */
  includeHidden?: boolean;
}

export interface DiscoveredFile {
  /** Absolute path to the SKILL.md (or equivalent) file. */
  path: string;
  /** Directory the file lives in. */
  dir: string;
  /** Depth below the supplied root (root itself counts as 0). */
  depth: number;
}

export interface DiscoverResult {
  files: DiscoveredFile[];
  /** Per-file errors (permission denied, broken symlink, etc.). */
  errors: { path: string; reason: string }[];
  /** Roots that did not exist or could not be read. */
  missingRoots: string[];
}

/**
 * Discover skill files under the given roots.
 *
 * @param roots    Absolute paths to walk.
 * @param options  Depth/filename/skip overrides.
 */
export async function discoverSkillFiles(
  roots: readonly string[],
  options: DiscoverOptions = {}
): Promise<DiscoverResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const filenames = options.filenames ?? DEFAULT_SKILL_FILENAMES;
  const skipDirs = new Set(options.skipDirs ?? DEFAULT_SKIP_DIRS);
  const includeHidden = options.includeHidden ?? false;

  const filenameSet = new Set(filenames);
  const result: DiscoverResult = { files: [], errors: [], missingRoots: [] };

  for (const rawRoot of roots) {
    const root = resolve(rawRoot);
    let exists = false;
    try {
      const s = await stat(root);
      exists = s.isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) {
      result.missingRoots.push(root);
      continue;
    }

    await walk(root, root, 0, maxDepth, filenameSet, skipDirs, includeHidden, result);
  }

  return result;
}

async function walk(
  root: string,
  current: string,
  depth: number,
  maxDepth: number,
  filenames: Set<string>,
  skipDirs: Set<string>,
  includeHidden: boolean,
  result: DiscoverResult
): Promise<void> {
  if (depth > maxDepth) {
    return;
  }

  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (err: unknown) {
    result.errors.push({ path: current, reason: toMessage(err) });
    return;
  }

  for (const entry of entries) {
    const name = entry.name;
    const fullPath = join(current, name);

    // Skip dotfiles (e.g. .git, .cache) unless explicitly allowed.
    if (!includeHidden && name.startsWith('.')) {
      continue;
    }

    if (entry.isDirectory()) {
      if (skipDirs.has(name)) {
        continue;
      }
      // Only recurse into directories; symlinks are NOT followed.
      await walk(root, fullPath, depth + 1, maxDepth, filenames, skipDirs, includeHidden, result);
      continue;
    }

    if (entry.isFile() && filenames.has(name)) {
      result.files.push({
        path: fullPath,
        dir: current,
        depth,
      });
    }
  }
}

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Convenience helper for callers that only need a flat list of paths. */
export function extractPaths(result: DiscoverResult): string[] {
  return result.files.map((f) => f.path);
}

/** Re-export for tests that want the basename of a discovered root. */
export function rootLabel(root: PathLike): string {
  return basename(root.toString());
}
