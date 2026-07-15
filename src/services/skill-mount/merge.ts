/**
 * Skill Mount — Merge
 *
 * Combines MountedSkill candidates from multiple sources into a single,
 * conflict-resolved list. Priorities (highest wins):
 *
 *   project  >  user  >  external
 *
 * Conflicts produce a MountWarning instead of throwing — the caller decides
 * how to surface them (log, telemetry, etc.). All data flow here is
 * immutable: inputs are read-only, outputs are new arrays.
 */

import type {
  MountedSkill,
  MountResult,
  MountWarning,
  SkillSourceKind,
} from './types.js';

/** Higher number = higher priority. Used to resolve id collisions. */
const PRIORITY: Record<SkillSourceKind, number> = {
  project: 3,
  user: 2,
  external: 1,
};

export interface MergeOptions {
  /**
   * If true, merge skills that share the same id but are functionally
   * distinct (different originPath) as a single MountedSkill with the
   * highest-priority body. The losers are reported in warnings.
   * Default: true (matches "project overrides user overrides external").
   */
  overrideOnConflict?: boolean;
}

export function mergeMountedSkills(
  candidates: readonly MountedSkill[],
  options: MergeOptions = {}
): MountResult {
  const overrideOnConflict = options.overrideOnConflict ?? true;

  // Sort by priority descending so the first occurrence of an id wins.
  const sorted = [...candidates].sort(
    (a, b) => PRIORITY[b.source] - PRIORITY[a.source]
  );

  const byId = new Map<string, MountedSkill>();
  const warnings: MountWarning[] = [];

  for (const candidate of sorted) {
    const existing = byId.get(candidate.id);
    if (!existing) {
      byId.set(candidate.id, candidate);
      continue;
    }

    // Same priority + same id = hard collision (e.g. two project roots).
    // We still keep the first and warn so the user knows there is dup.
    warnings.push({
      id: candidate.id,
      overriddenSource: candidate.source,
      winningSource: existing.source,
      winningPath: existing.originPath,
      overriddenPath: candidate.originPath,
    });

    if (!overrideOnConflict) {
      // Caller wants to keep both: assign a disambiguated id so neither is lost.
      let suffix = 2;
      let newId = `${candidate.id}#${suffix}`;
      while (byId.has(newId)) {
        suffix += 1;
        newId = `${candidate.id}#${suffix}`;
      }
      byId.set(newId, { ...candidate, id: newId });
    }
    // else: the existing (higher-priority) entry remains; we just record the warning.
  }

  return {
    skills: Array.from(byId.values()),
    warnings,
  };
}

/** Stable, lowercased id derived from a free-form skill name. */
export function normalizeId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Convenience: count skills per source kind, for diagnostics. */
export function countBySource(skills: readonly MountedSkill[]): Record<SkillSourceKind, number> {
  const counts: Record<SkillSourceKind, number> = { project: 0, user: 0, external: 0 };
  for (const s of skills) {
    counts[s.source] += 1;
  }
  return counts;
}
