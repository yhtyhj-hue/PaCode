/** Safe formatting for untrusted Brave result content. */

import type { WebSearchResult } from './types.js';

export const MAX_SNIPPET_LENGTH = 500;
export const MAX_TITLE_LENGTH = 200;

interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SanitizedText {
  value: string;
  reasons: string[];
}

const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+instructions?/gi,
  /disregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+instructions?/gi,
];
const BASE64_TOKEN_PATTERN = /(^|\s)(?=[A-Za-z0-9+/]{24,}={0,2}(?=\s|$))(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[0-9+/=])([A-Za-z0-9+/]{24,}={0,2})(?=\s|$)/g;
// eslint-disable-next-line no-control-regex -- 刻意匹配含 NUL 的非 ASCII 长串
const LONG_UNICODE_PATTERN = /[^\x00-\x7F]{16,}/gu;

function isUnicodeControlCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x00 && codePoint <= 0x08) ||
    codePoint === 0x0b ||
    codePoint === 0x0c ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    codePoint === 0x7f ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x2064) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

function stripUnicodeControls(value: string): { value: string; stripped: boolean } {
  const filtered = Array.from(value).filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return !isUnicodeControlCodePoint(codePoint);
  });
  return { value: filtered.join(''), stripped: filtered.length !== Array.from(value).length };
}

/** Escape HTML metacharacters before result text is shown to a renderer. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function markStripped(value: string, reason: string): string {
  return `${value.trim()} [stripped:${reason}]`.trim();
}

/** Remove common prompt-injection payloads without trusting result prose. */
export function sanitizeUntrustedText(value: string): SanitizedText {
  let sanitized = value;
  const reasons: string[] = [];

  for (const pattern of INSTRUCTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      sanitized = sanitized.replace(pattern, '');
      reasons.push('prompt-injection');
    }
    pattern.lastIndex = 0;
  }

  if (BASE64_TOKEN_PATTERN.test(sanitized)) {
    sanitized = sanitized.replace(BASE64_TOKEN_PATTERN, '$1');
    reasons.push('base64');
  }
  BASE64_TOKEN_PATTERN.lastIndex = 0;

  const unicodeResult = stripUnicodeControls(sanitized);
  if (unicodeResult.stripped) {
    sanitized = unicodeResult.value;
    reasons.push('unicode-control');
  }

  if (LONG_UNICODE_PATTERN.test(sanitized)) {
    sanitized = sanitized.replace(LONG_UNICODE_PATTERN, '');
    reasons.push('unicode-payload');
  }
  LONG_UNICODE_PATTERN.lastIndex = 0;

  const uniqueReasons = Array.from(new Set(reasons));
  for (const reason of uniqueReasons) {
    sanitized = markStripped(sanitized, reason);
  }

  return { value: sanitized, reasons: uniqueReasons };
}

function truncate(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join('');
}

/** Only network URLs are allowed as citations. */
export function isValidResultUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function prepareResult(result: RawSearchResult): WebSearchResult | null {
  if (!isValidResultUrl(result.url)) return null;

  const title = sanitizeUntrustedText(result.title).value || 'Untitled result';
  const snippet = sanitizeUntrustedText(result.snippet).value || 'No snippet available.';

  return {
    title: escapeHtml(truncate(title, MAX_TITLE_LENGTH)),
    url: escapeHtml(result.url),
    snippet: escapeHtml(truncate(snippet, MAX_SNIPPET_LENGTH)),
  };
}

/** Format one untrusted result as the Claude Code style citation line. */
export function formatSearchResult(result: RawSearchResult): string {
  const prepared = prepareResult(result);
  if (!prepared) throw new Error('Invalid search result URL');
  return `${prepared.title} — ${prepared.url} — ${prepared.snippet}`;
}

/** Validate, sanitize and format all results, dropping invalid URLs. */
export function formatSearchResults(results: readonly RawSearchResult[]): string {
  return results
    .map((result) => {
      const prepared = prepareResult(result);
      return prepared ? `${prepared.title} — ${prepared.url} — ${prepared.snippet}` : null;
    })
    .filter((result): result is string => result !== null)
    .join('\n');
}

/** Format results that have already passed prepareResult in the search pipeline. */
export function formatPreparedResults(results: readonly WebSearchResult[]): string {
  return results.map((result) => `${result.title} — ${result.url} — ${result.snippet}`).join('\n');
}

export function sanitizeSearchResult(result: RawSearchResult): WebSearchResult | null {
  return prepareResult(result);
}
