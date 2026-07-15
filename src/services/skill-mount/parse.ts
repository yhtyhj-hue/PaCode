/**
 * Skill Mount — YAML frontmatter parser
 *
 * Parses the simple `--- key: value ---` frontmatter used by SKILL.md.
 * This is a deliberately minimal parser:
 *   - scalar values only (no nested mappings, no sequences, no anchors)
 *   - comma-separated lists for when_to_use and tools
 *   - unknown keys are kept verbatim under .extra
 *
 * If parsing fails (malformed frontmatter, missing required name/description),
 * the function returns { ok: false, reason } instead of throwing. Callers
 * decide how to surface the error (skip, warn, etc.).
 */

import type { ParseResult, SkillFrontmatter } from './types.js';

/** Regex that matches the opening or closing `---` fence on its own line. */
const FENCE_RE = /^---\s*$/;

/** Regex that matches `key: value` (value may be empty). Captures trimmed key. */
const KV_RE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/;

/** Normalize the head to upper case + strip. */
function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/** Split a comma-separated list, drop empties, trim each item. */
function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse the YAML frontmatter block from a SKILL.md body.
 *
 * @param raw  Full SKILL.md contents (including the body after frontmatter).
 * @returns    Either { ok: true, frontmatter } or { ok: false, reason }.
 *
 * Note: if the file has no frontmatter, the caller is expected to synthesize
 * a minimal SkillFrontmatter using the directory name. This function only
 * sees files that DO have a `---` fence at the top.
 */
export function parseFrontmatter(raw: string): ParseResult {
  // Normalize newlines so \r\n inputs behave the same.
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  if (lines.length === 0 || !FENCE_RE.test(lines[0] ?? '')) {
    return { ok: false, reason: 'missing opening frontmatter fence' };
  }

  const collected: Record<string, string> = {};
  let closed = false;
  let endIndex = lines.length;

  // Walk lines until the closing fence.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (FENCE_RE.test(line)) {
      closed = true;
      endIndex = i;
      break;
    }
    const match = KV_RE.exec(line);
    if (!match) {
      // Unknown line (blank, comment, multi-line scalar continuation...).
      // We deliberately skip silently — the limited grammar is intentional.
      continue;
    }
    const key = match[1] ?? '';
    const rawValue = match[2] ?? '';
    collected[key] = stripQuotes(rawValue);
  }

  if (!closed) {
    return { ok: false, reason: 'unterminated frontmatter (no closing ---)' };
  }

  const name = collected.name;
  const description = collected.description;

  if (!name || name.length === 0) {
    return { ok: false, reason: 'missing required field: name' };
  }
  if (!description || description.length === 0) {
    return { ok: false, reason: 'missing required field: description' };
  }

  const known = new Set(['name', 'description', 'when_to_use', 'tools']);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(collected)) {
    if (!known.has(k)) {
      extra[k] = v;
    }
  }

  const frontmatter: SkillFrontmatter = {
    name,
    description,
    whenToUse:
      collected.when_to_use !== undefined ? splitList(collected.when_to_use) : undefined,
    tools: collected.tools !== undefined ? splitList(collected.tools) : undefined,
    extra,
  };

  // Side-channel: how many lines were consumed (frontmatter block length).
  // We don't return it directly because ParseResult only carries frontmatter,
  // but downstream code can re-split using the same logic if needed.
  void endIndex;

  return { ok: true, frontmatter };
}

/**
 * Extract the markdown body that follows the frontmatter block.
 * Returns the entire raw string if there is no frontmatter.
 */
export function stripFrontmatter(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  if (lines.length === 0 || !FENCE_RE.test(lines[0] ?? '')) {
    return text.trim();
  }

  for (let i = 1; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i] ?? '')) {
      return lines.slice(i + 1).join('\n').trim();
    }
  }

  return text.trim();
}
