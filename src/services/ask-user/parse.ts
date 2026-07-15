/**
 * Answer parsing for AskUserQuestion.
 *
 * Supported input shapes:
 *   "1", "2" ...           → numeric selection (1-indexed)
 *   "yes", "no"            → case-insensitive substring against label
 *   "security, perf"       → comma-separated multi-select
 *   "1 3"                  → space-separated multi-select
 *   ""                     → empty (caller decides default vs. retry)
 *   unrecognised           → { ok: false, hint } so the caller can re-prompt
 */

import type { AskUserOption } from './types.js';

const MAX_LABEL_HINT_LENGTH = 30;

export interface ParseSuccess {
  ok: true;
  selection: string | string[];
}

export interface ParseFailure {
  ok: false;
  hint: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

const normalize = (s: string): string => s.trim().toLowerCase();

function matchSingle(token: string, options: AskUserOption[]): string | null {
  const normalized = normalize(token);
  if (!normalized) return null;

  // Numeric → 1-indexed.
  if (/^\d+$/.test(normalized)) {
    const idx = Number.parseInt(normalized, 10);
    const option = options[idx - 1];
    return option ? option.id : null;
  }

  // Exact id match (case-insensitive).
  const byId = options.find((o) => normalize(o.id) === normalized);
  if (byId) return byId.id;

  // Label substring match.
  const byLabel = options.find((o) => normalize(o.label).includes(normalized));
  if (byLabel) return byLabel.id;

  // Description substring match.
  const byDescription = options.find((o) =>
    o.description ? normalize(o.description).includes(normalized) : false
  );
  if (byDescription) return byDescription.id;

  return null;
}

function tokensOf(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function buildHint(options: AskUserOption[], multi: boolean): string {
  const summary = options
    .map((o, i) => `${i + 1}. ${o.label}`)
    .slice(0, MAX_LABEL_HINT_LENGTH)
    .join('; ');
  return multi
    ? `Pick one or more of: ${summary}`
    : `Pick one of: ${summary}`;
}

export function parseAnswer(
  raw: string,
  options: AskUserOption[],
  multi: boolean
): ParseResult {
  if (!raw || !raw.trim()) {
    return { ok: false, hint: 'Empty answer. ' + buildHint(options, multi) };
  }

  const tokens = tokensOf(raw);
  if (tokens.length === 0) {
    return { ok: false, hint: buildHint(options, multi) };
  }

  if (multi) {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const t of tokens) {
      const id = matchSingle(t, options);
      if (!id) {
        return { ok: false, hint: `Unknown token: "${t}". ${buildHint(options, multi)}` };
      }
      if (!seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
    return { ok: true, selection: ordered };
  }

  if (tokens.length > 1) {
    return { ok: false, hint: 'Single-select accepts one value. ' + buildHint(options, multi) };
  }

  const id = matchSingle(tokens[0] as string, options);
  if (!id) {
    return { ok: false, hint: buildHint(options, multi) };
  }
  return { ok: true, selection: id };
}
