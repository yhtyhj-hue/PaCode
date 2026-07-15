/**
 * Prompt injection defense
 *
 * The WebFetch tool returns untrusted HTML/text directly into the agent
 * context. We strip known prompt-injection carriers before returning the
 * result, and emit warnings describing what was removed. We never abort:
 * the agent still gets a useful page summary, just with hostile blocks
 * excised.
 *
 * Detection categories:
 *  - HTML comments (<!-- ... -->)
 *  - CSS-hidden content (display:none, visibility:hidden, opacity:0)
 *  - Common "ignore previous instructions" / "you are now" patterns
 *  - Long base64 blobs that may hide instructions
 *
 * The function is pure: input strings are never mutated.
 */

import type { SanitizationWarning } from './types.js';

interface SanitizeResult {
  text: string;
  warnings: SanitizationWarning[];
}

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

// inline style="..." attributes where the value contains a hiding property
const HIDING_STYLE_RE = /style\s*=\s*"([^"]*)"/gi;
const HIDING_PROPS = /(?:^|;|\s)(display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.|$)|font-size\s*:\s*0(?:px|%)?|color\s*:\s*transparent)/i;

// <tag style="..."> ... </tag> blocks carrying a hiding style
const HIDING_BLOCK_RE = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*style\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/\1>/gi;

// standalone style blocks
const STYLE_BLOCK_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;

const BASE64_RE = /\b(?:[A-Za-z0-9+/]{120,}={0,2})\b/g;

const IGNORE_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts?|directives?)/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts?)/i,
  /you\s+are\s+now\s+(?:a|an)\s+[a-z0-9 ,.\-]{2,80}/i,
  /system\s*:\s*you\s+are/i,
  /new\s+instructions?\s*:/i,
  /forget\s+(?:everything|all)\s+(?:above|before)/i,
  /<\/?system[^>]*>/i,
  /\bact\s+as\s+(?:a|an)\s+[a-z]+/i,
];

const INLINE_BASE64_MAX_LEN = 200;
const HINT_BLOCK_BASE64_MIN_LEN = 120;

/**
 * Strip a base64 blob into a short "[base64:N chars]" marker so the
 * underlying bytes do not leak into the agent context.
 */
function maskBase64(match: string): string {
  return `[base64:${match.length} chars]`;
}

/**
 * Run sanitization on raw HTML and emit a cleaned, plain-text representation
 * together with the warnings that were collected during the run.
 */
export function sanitizePromptInjection(input: string): SanitizeResult {
  if (input.length === 0) {
    return { text: '', warnings: [] };
  }

  const warnings: SanitizationWarning[] = [];
  let working = input;

  // 1) Strip <style>...</style> blocks outright (CSS is irrelevant for text).
  const styleCount = countMatches(working, STYLE_BLOCK_RE);
  if (styleCount > 0) {
    working = working.replace(STYLE_BLOCK_RE, ' ');
    warnings.push({
      kind: 'style_block',
      detail: `Removed ${styleCount} <style> block(s) to prevent CSS-hidden instructions`,
    });
  }

  // 2) Strip HTML comments.
  const commentCount = countMatches(working, HTML_COMMENT_RE);
  if (commentCount > 0) {
    working = working.replace(HTML_COMMENT_RE, ' ');
    warnings.push({
      kind: 'html_comment',
      detail: `Removed ${commentCount} HTML comment block(s)`,
    });
  }

  // 3) Strip entire elements that carry a CSS-hiding style attribute.
  const hidingBlocks: string[] = [];
  working = working.replace(HIDING_BLOCK_RE, (_match, _tag, styleValue, inner) => {
    if (HIDING_PROPS.test(styleValue)) {
      hidingBlocks.push(inner);
      return ' ';
    }
    return _match;
  });
  if (hidingBlocks.length > 0) {
    const chars = hidingBlocks.reduce((sum, b) => sum + b.length, 0);
    warnings.push({
      kind: 'css_hidden_block',
      detail: `Removed ${hidingBlocks.length} CSS-hidden element(s) (${chars} chars)`,
    });
  }

  // 4) Also strip inline "display:none" / "visibility:hidden" style snippets
  //    even when they are not attached to a complete element (defensive).
  let inlineStyleHits = 0;
  working = working.replace(HIDING_STYLE_RE, (match, value) => {
    if (HIDING_PROPS.test(value)) {
      inlineStyleHits += 1;
      return ' ';
    }
    return match;
  });
  if (inlineStyleHits > 0) {
    warnings.push({
      kind: 'css_hidden_inline',
      detail: `Removed ${inlineStyleHits} inline CSS-hiding style(s)`,
    });
  }

  // 5) Mask long base64 blobs that may carry hidden instructions.
  const base64Blobs: number[] = [];
  working = working.replace(BASE64_RE, (match) => {
    if (match.length >= HINT_BLOCK_BASE64_MIN_LEN) {
      base64Blobs.push(match.length);
      return maskBase64(match);
    }
    return match;
  });
  if (base64Blobs.length > 0) {
    const total = base64Blobs.reduce((a, b) => a + b, 0);
    warnings.push({
      kind: 'base64_blob',
      detail: `Masked ${base64Blobs.length} base64 blob(s) (${total} chars total)`,
    });
  }

  // 6) Detect adversarial natural-language injection patterns and remove
  //    the surrounding sentence. We never just "warn" without removing,
  //    because the agent cannot be trusted to ignore them.
  const triggeredPatterns = new Set<string>();
  IGNORE_PATTERNS.forEach((re, idx) => {
    if (re.test(working)) {
      triggeredPatterns.add(`#${idx}`);
    }
  });
  if (triggeredPatterns.size > 0) {
    IGNORE_PATTERNS.forEach((re) => {
      working = working.replace(re, ' ');
    });
    warnings.push({
      kind: 'instruction_injection',
      detail: `Stripped ${triggeredPatterns.size} instruction-override pattern(s)`,
    });
  }

  return { text: working, warnings };
}

function countMatches(input: string, re: RegExp): number {
  const cloned = new RegExp(re.source, re.flags);
  let count = 0;
  while (cloned.exec(input) !== null) {
    count += 1;
    if (cloned.lastIndex === input.length) {
      // Avoid infinite loop on zero-width matches.
      cloned.lastIndex += 1;
    }
  }
  return count;
}

/**
 * Helper used by tests / callers to mask a base64 blob deterministically.
 */
export function maskBase64Blob(blob: string): string {
  if (blob.length < INLINE_BASE64_MAX_LEN) return blob;
  return `[base64:${blob.length} chars]`;
}