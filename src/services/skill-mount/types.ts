/**
 * Skill Mount — Public Types
 *
 * The skill mount layer lets PaCode discover, parse, and merge skills
 * from arbitrary directories on disk (e.g. everything-claude-code/skills/).
 *
 * This module defines the contract for skill sources and the MountedSkill
 * shape returned by loadExternalSkills. It deliberately does NOT replace
 * src/skills/loader.ts — see README.md for the integration boundary.
 */

export type SkillSourceKind =
  | 'project' // <cwd>/.paude/skills or <cwd>/.claude/skills
  | 'user' // ~/.paude/skills
  | 'external'; // any extra root (e.g. ~/everything-claude-code/skills)

export interface SkillSource {
  /** Absolute path to the root directory to walk. */
  root: string;
  /** Source kind — drives merge priority. */
  kind: SkillSourceKind;
  /** Optional human label for diagnostics (defaults to root basename). */
  label?: string;
}

export interface SkillMountConfig {
  /** Roots to scan, in priority order (highest priority first). */
  roots: SkillSource[];
  /** Maximum recursion depth when walking a root (default 5). */
  maxDepth?: number;
  /** File names that count as a skill entry point (default ['SKILL.md']). */
  filenames?: string[];
  /** Directories to skip during traversal (default ['node_modules', '.git']). */
  skipDirs?: string[];
}

export interface SkillFrontmatter {
  /** Skill name (required). */
  name: string;
  /** Short description used by the agent to decide when to invoke the skill. */
  description: string;
  /** Optional "when to use" trigger phrases. */
  whenToUse?: string[];
  /** Optional list of tool ids the skill relies on. */
  tools?: string[];
  /** Any additional unknown fields are kept here verbatim. */
  extra: Record<string, string>;
}

export type ParseResult =
  | { ok: true; frontmatter: SkillFrontmatter }
  | { ok: false; reason: string };

export interface MountedSkill {
  /** Stable id: lowercased name. */
  id: string;
  /** Skill display name from frontmatter or directory name. */
  name: string;
  /** Which source kind produced this skill. */
  source: SkillSourceKind;
  /** Absolute path to the SKILL.md file. */
  originPath: string;
  /** Original markdown body (frontmatter stripped). */
  content: string;
  /** Parsed frontmatter (or a synthesized minimal one if absent). */
  frontmatter: SkillFrontmatter;
  /** Whether the skill is enabled (currently always true at mount time). */
  enabled: boolean;
}

export interface MountWarning {
  /** Which skill id triggered the warning. */
  id: string;
  /** Which source kind lost the conflict. */
  overriddenSource: SkillSourceKind;
  /** Which source kind won the conflict. */
  winningSource: SkillSourceKind;
  /** Original path of the winning skill (for diagnostics). */
  winningPath: string;
  /** Original path of the overridden skill. */
  overriddenPath: string;
}

export interface MountResult {
  skills: MountedSkill[];
  warnings: MountWarning[];
}

export const DEFAULT_MAX_DEPTH = 5;
export const DEFAULT_SKILL_FILENAMES: readonly string[] = ['SKILL.md'];
export const DEFAULT_SKIP_DIRS: readonly string[] = ['node_modules', '.git'];
