/**
 * HTML -> plain text extraction
 *
 * Minimal vanilla implementation: remove <script>, <style>, <head>, and
 * HTML comments, then strip remaining tags and collapse whitespace.
 *
 * This is intentionally not a full HTML parser. The goal is to give the
 * downstream model readable text while staying dependency-free.
 */

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const HEAD_RE = /<head\b[^>]*>[\s\S]*?<\/head>/gi;
const NOSCRIPT_RE = /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi;
const SVG_RE = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9]*[^>]*>/g;
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

/**
 * Decode the most common HTML entities. We keep this list narrow on
 * purpose; anything outside it is left alone.
 */
function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return _m;
      try {
        return String.fromCodePoint(n);
      } catch {
        return _m;
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const n = parseInt(hex, 16);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return _m;
      try {
        return String.fromCodePoint(n);
      } catch {
        return _m;
      }
    });
}

/**
 * Convert raw HTML into a plain-text representation. Whitespace is
 * normalized and block-level tags produce paragraph breaks.
 */
export function htmlToText(html: string): string {
  if (html.length === 0) return '';

  let working = html;

  // Drop irrelevant blocks first.
  working = working.replace(SCRIPT_RE, ' ');
  working = working.replace(STYLE_RE, ' ');
  working = working.replace(NOSCRIPT_RE, ' ');
  working = working.replace(SVG_RE, ' ');
  working = working.replace(HEAD_RE, ' ');
  working = working.replace(COMMENT_RE, ' ');

  // Walk tags, emitting newlines for block-level boundaries.
  // 先把 <a href> 换成 markdown 链接，保留引用场景
  working = working.replace(
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => {
      const label = inner.replace(TAG_RE, '').replace(/\s+/g, ' ').trim() || href;
      return `[${label}](${href})`;
    }
  );

  const out: string[] = [];
  const tagMatcher = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tagMatcher.exec(working)) !== null) {
    const tag = (match[1] ?? '').toLowerCase();
    const before = working.slice(lastIndex, match.index);
    out.push(before);
    if (BLOCK_TAGS.has(tag)) {
      // <br> should not produce double newlines; everything else does.
      if (tag === 'br') {
        out.push('\n');
      } else {
        out.push('\n\n');
      }
    }
    lastIndex = match.index + match[0].length;
  }
  out.push(working.slice(lastIndex));

  let text = out.join('');

  // Strip any remaining tags defensively (some inline tags may survive).
  text = text.replace(TAG_RE, '');

  text = decodeEntities(text);

  // Collapse runs of whitespace, but preserve paragraph breaks.
  text = text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}