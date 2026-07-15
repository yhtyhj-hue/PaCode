/**
 * Skill Mount — Public API
 *
 * `loadExternalSkills(config)` is the entry point used by Stage 2 integration
 * to splice external skill sources (e.g. everything-claude-code/skills/) into
 * PaCode's existing skill pipeline.
 *
 * This module does NOT replace src/skills/loader.ts. It is a discovery +
 * parsing layer that produces MountedSkill records; the existing loader (or
 * a thin adapter in Stage 2) consumes those records and feeds them into the
 * agent context. See README.md for the integration sketch.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { discoverSkillFiles } from './discover.js';
import { parseFrontmatter, stripFrontmatter } from './parse.js';
import { mergeMountedSkills, normalizeId } from './merge.js';
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_SKILL_FILENAMES,
  DEFAULT_SKIP_DIRS,
  type MountResult,
  type MountedSkill,
  type SkillMountConfig,
  type SkillSourceKind,
} from './types.js';

/** Default fallback roots used when the caller does not supply any. */
export function defaultRoots(cwd: string, home: string): {
  root: string;
  kind: SkillSourceKind;
}[] {
  return [
    { root: `${cwd}/.paude/skills`, kind: 'project' },
    { root: `${cwd}/.claude/skills`, kind: 'project' },
    { root: `${home}/.paude/skills`, kind: 'user' },
    { root: `${home}/everything-claude-code/skills`, kind: 'external' },
  ];
}

export interface LoadExternalSkillsOptions {
  /**
   * If false, the function silently skips SKILL.md files whose frontmatter
   * fails to parse. If true (default), the parse failure is recorded as a
   * warning-shaped object in the returned `mount.warnings` via an extra
   * `parseErrors` field. We keep the legacy shape so existing callers do
   * not break.
   */
  reportParseErrors?: boolean;
}

export interface LoadExternalSkillsResult extends MountResult {
  /** Per-file frontmatter parse failures (skipped, not loaded). */
  parseErrors: { path: string; reason: string }[];
}

/**
 * Walk all configured roots, parse every discovered SKILL.md, merge them
 * with priority resolution, and return the unified list.
 */
export async function loadExternalSkills(
  config: SkillMountConfig,
  options: LoadExternalSkillsOptions = {}
): Promise<LoadExternalSkillsResult> {
  const reportParseErrors = options.reportParseErrors ?? true;

  const maxDepth = config.maxDepth ?? DEFAULT_MAX_DEPTH;
  const filenames = config.filenames ?? DEFAULT_SKILL_FILENAMES;
  const skipDirs = config.skipDirs ?? DEFAULT_SKIP_DIRS;

  const discovery = await discoverSkillFiles(
    config.roots.map((r) => r.root),
    { maxDepth, filenames, skipDirs }
  );

  const candidates: MountedSkill[] = [];
  const parseErrors: { path: string; reason: string }[] = [];

  for (const file of discovery.files) {
    const source = lookupSource(config, file.path);
    if (!source) {
      // File came from a root that isn't in the config (shouldn't happen,
      // but guard anyway). Skip with diagnostic.
      parseErrors.push({
        path: file.path,
        reason: 'discovered file has no matching source in config',
      });
      continue;
    }

    let raw: string;
    try {
      raw = await readFile(file.path, 'utf-8');
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      parseErrors.push({ path: file.path, reason: `read failed: ${reason}` });
      continue;
    }

    const body = stripFrontmatter(raw);
    const parsed = parseFrontmatter(raw);

    if (!parsed.ok) {
      if (reportParseErrors) {
        parseErrors.push({ path: file.path, reason: parsed.reason });
      }
      continue;
    }

    const frontmatter = parsed.frontmatter;
    const dirName = basename(file.dir);
    let id = normalizeId(frontmatter.name);
    let displayName = frontmatter.name;

    // If id collapsed to empty (e.g. name was "!!!" only), fall back to dir name.
    if (id.length === 0) {
      id = normalizeId(dirName);
      displayName = frontmatter.name || dirName;
    }

    const skill: MountedSkill = {
      id,
      name: displayName,
      source: source.kind,
      originPath: file.path,
      content: body,
      frontmatter,
      enabled: true,
    };

    candidates.push(skill);
  }

  const merged = mergeMountedSkills(candidates);

  // Also surface discovery-level errors as parseErrors so callers can log
  // them in a single stream.
  for (const e of discovery.errors) {
    parseErrors.push({ path: e.path, reason: `discovery: ${e.reason}` });
  }

  return {
    skills: merged.skills,
    warnings: merged.warnings,
    parseErrors,
  };
}

/** Find which configured source owns a given discovered file path. */
function lookupSource(
  config: SkillMountConfig,
  filePath: string
): { root: string; kind: SkillSourceKind } | undefined {
  // Match the longest root that is a strict prefix of the file path.
  let best: { root: string; kind: SkillSourceKind; len: number } | undefined;
  for (const r of config.roots) {
    const root = r.root.replace(/\/+$/, '');
    if (filePath === root) {
      // SKILL.md sitting directly at the root is valid (rare but supported).
      if (!best || root.length > best.len) {
        best = { root: r.root, kind: r.kind, len: root.length };
      }
      continue;
    }
    if (filePath.startsWith(root + '/')) {
      if (!best || root.length > best.len) {
        best = { root: r.root, kind: r.kind, len: root.length };
      }
    }
  }
  return best;
}

// Re-exports so consumers can import everything from the module root.
export type {
  MountedSkill,
  MountResult,
  MountWarning,
  ParseResult,
  SkillFrontmatter,
  SkillMountConfig,
  SkillSource,
  SkillSourceKind,
} from './types.js';
export { discoverSkillFiles } from './discover.js';
export { parseFrontmatter, stripFrontmatter } from './parse.js';
export { mergeMountedSkills, normalizeId } from './merge.js';
