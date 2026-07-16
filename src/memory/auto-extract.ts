/**
 * I1: Auto-extract auditable memory.
 *
 * Distinguishes this layer from the broader MemoryStore (which
 * is the user-explicit ~/.paude/memory/ model). This module
 * focuses on *automatic* capture from conversation:
 * - runs at the Stop hook (H3 already wires runStopHooks into
 *   REPL's processMessage finally)
 * - extracts "factual" statements from user/assistant messages
 *   using a small set of lightweight patterns (no LLM call —
 *   we keep cost and non-determinism out of the memory path)
 * - appends matches to ~/.paude/memory/auto/<date>.json
 *   (one file per day; JSON; git-friendly diff/rollback)
 * - records extraction source (message index, role) so the user
 *   can audit or roll back via the existing MemoryStore
 *
 * The pattern set is intentionally narrow. The point is to
 * capture *some* auditable knowledge automatically and let
 * humans review via /memory or git diff, not to extract
 * everything.
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Message } from '../pkg/types.js';

export interface ExtractedFact {
  /** Auto-incrementing id within the day, formatted as 0001, 0002. */
  id: string;
  /** ISO timestamp of the original message. */
  ts: string;
  /** Source message index within the session. */
  messageIndex: number;
  /** Source role: 'user' or 'assistant'. */
  role: 'user' | 'assistant';
  /** The matched factual line (one per capture). */
  fact: string;
  /** Which pattern matched (for audit trail). */
  pattern: string;
}

/**
 * Pattern set kept narrow on purpose. Each pattern must be a
 * regex that captures a single "factual" line — i.e. someone
 * asserting a verifiable claim, not asking a question. The
 * capturing group is the fact text.
 *
 * Categories are intentionally human-readable so the audit
 * /memory view can group them.
 */
const PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  // "X 是 Y" / "X 是 Y。" (Chinese definitional statements)
  { name: 'is-def-zh', re: /^(.{2,40}?)\s*是\s*(.{2,80}?)[。.!！?？\s]*$/ },
  // "the project uses X" / "项目用 X" / "项目使用 X"
  { name: 'project-uses', re: /^(?:the\s+project|项目|project)\s*(?:uses?|用|使用)\s+(.{2,80}?)[。.!！?？\s]*$/i },
  // "set X to Y" / "设置 X 为 Y"
  { name: 'set-config', re: /^(?:set|设置)\s+(\w+)\s+(?:to|为)\s+(.{2,80}?)[。.!！?？\s]*$/i },
  // "decided to X" / "决定 X"
  { name: 'decision', re: /^(?:we\s+)?(?:decided|决定)\s+(?:to\s+)?(.{2,80}?)[。.!！?？\s]*$/i },
];

/** Extract facts from a list of messages. */
export function extractFacts(messages: Message[]): ExtractedFact[] {
  const out: ExtractedFact[] = [];
  let dailySeq = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = extractText(m);
    if (!text) continue;

    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length < 4 || trimmed.length > 200) continue;
      // Skip questions, exclamations, code-fenced content
      if (trimmed.endsWith('?') || trimmed.endsWith('？')) continue;
      if (trimmed.startsWith('```') || trimmed.startsWith('#')) continue;

      for (const { name, re } of PATTERNS) {
        const m2 = re.exec(trimmed);
        if (m2) {
          dailySeq += 1;
          out.push({
            id: String(dailySeq).padStart(4, '0'),
            ts: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
            messageIndex: i,
            role: m.role,
            fact: trimmed,
            pattern: name,
          });
          break; // one fact per line
        }
      }
    }
  }
  return out;
}

/** Extract the text body from a Message.content (string or content blocks). */
function extractText(m: Message): string {
  if (typeof m.content === 'string') return m.content;
  if (!Array.isArray(m.content)) return '';
  return m.content
    .map((b) => ('text' in b && b.text ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

export interface AutoExtractOptions {
  /** Override the storage root (default: ~/.paude/memory/auto). */
  baseDir?: string;
  /** If true, do not write — just return facts. */
  dryRun?: boolean;
}

/**
 * Append extracted facts to a per-day JSONL file. Returns the
 * list of facts that were written (empty array on dry-run).
 */
export async function recordAutoMemory(
  messages: Message[],
  options: AutoExtractOptions = {}
): Promise<ExtractedFact[]> {
  const facts = extractFacts(messages);
  if (facts.length === 0) return [];
  if (options.dryRun) return facts;

  const baseDir = options.baseDir ?? join(homedir(), '.paude', 'memory', 'auto');
  const day = new Date().toISOString().slice(0, 10);
  const filePath = join(baseDir, `${day}.jsonl`);

  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }

  const lines = facts.map((f) => JSON.stringify(f)).join('\n') + '\n';
  appendFileSync(filePath, lines, 'utf-8');
  return facts;
}