/**
 * WebFetch core: fetch a URL, extract text, sanitize for prompt injection.
 *
 * Errors are classified into a small set of `WebFetchErrorKind`s so that
 * callers (including the tool layer) can map failures to user-friendly
 * messages without sniffing Error messages.
 */

import { sanitizePromptInjection } from './prompt-injection.js';
import { htmlToText } from './extract.js';
import type {
  SanitizationWarning,
  WebFetchError,
  WebFetchErrorKind,
  WebFetchOptions,
  WebFetchOutput,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_USER_AGENT = 'pacode-web-fetch/1.0';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export class WebFetchException extends Error {
  readonly kind: WebFetchErrorKind;
  readonly status?: number;
  readonly url?: string;

  constructor(error: WebFetchError) {
    super(error.message);
    this.name = 'WebFetchException';
    this.kind = error.kind;
    if (error.status !== undefined) this.status = error.status;
    if (error.url !== undefined) this.url = error.url;
  }
}

/**
 * Public entry point. Returns a structured result; throws
 * `WebFetchException` for transport-level failures.
 */
export async function webFetch(
  url: string,
  options: WebFetchOptions = {}
): Promise<WebFetchOutput> {
  const validatedUrl = validateUrl(url);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = options.signal;

  let onUpstreamAbort: (() => void) | null = null;
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      onUpstreamAbort = () => controller.abort();
      upstreamSignal.addEventListener('abort', onUpstreamAbort);
    }
  }

  try {
    let currentUrl = validatedUrl;
    let redirects = 0;

    for (;;) {
      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': userAgent,
            Accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.5',
          },
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new WebFetchException({
            kind: 'timeout',
            message: `Request timed out after ${timeoutMs}ms`,
            url: currentUrl,
          });
        }
        throw classifyNetworkError(err, currentUrl);
      }

      // Manual redirect handling so we can count hops and stop on loops.
      if (isRedirectStatus(response.status)) {
        const location = response.headers.get('location');
        // Drain the body so the connection can be released.
        await safeDrain(response);
        if (!location) {
          throw new WebFetchException({
            kind: 'http_status',
            message: `Redirect with no Location header (status ${response.status})`,
            status: response.status,
            url: currentUrl,
          });
        }
        redirects += 1;
        if (redirects > maxRedirects) {
          throw new WebFetchException({
            kind: 'redirect_loop',
            message: `Exceeded ${maxRedirects} redirect(s)`,
            url: currentUrl,
          });
        }
        const nextUrl = resolveRedirect(currentUrl, location);
        currentUrl = validateUrl(nextUrl);
        continue;
      }

      if (!response.ok) {
        await safeDrain(response);
        throw new WebFetchException({
          kind: 'http_status',
          message: `HTTP ${response.status} ${response.statusText || ''}`.trim(),
          status: response.status,
          url: currentUrl,
        });
      }

      const { text, bytes } = await readBoundedText(response, maxBytes, currentUrl);

      const sanitized = sanitizePromptInjection(text);
      const extracted = looksLikeHtml(response.headers.get('content-type'))
        ? htmlToText(sanitized.text)
        : sanitized.text;

      return {
        url,
        finalUrl: currentUrl,
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        text: extracted,
        bytes,
        warnings: sanitized.warnings,
        sanitized: sanitized.warnings.length > 0,
      };
    }
  } finally {
    clearTimeout(timer);
    if (upstreamSignal && onUpstreamAbort) {
      upstreamSignal.removeEventListener('abort', onUpstreamAbort);
    }
  }
}

function validateUrl(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new WebFetchException({
      kind: 'invalid_url',
      message: 'URL must be a non-empty string',
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new WebFetchException({
      kind: 'invalid_url',
      message: `Invalid URL: ${input}`,
    });
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new WebFetchException({
      kind: 'invalid_url',
      message: `Refusing URL with disallowed protocol "${parsed.protocol}"`,
    });
  }
  return parsed.toString();
}

function resolveRedirect(base: string, location: string): string {
  // Relative Location headers are allowed by HTTP; let URL resolve them.
  try {
    return new URL(location, base).toString();
  } catch {
    throw new WebFetchException({
      kind: 'invalid_url',
      message: `Invalid redirect target: ${location}`,
    });
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function classifyNetworkError(err: unknown, url: string): WebFetchException {
  const message = err instanceof Error ? err.message : String(err);
  return new WebFetchException({
    kind: 'network',
    message: `Network error: ${message}`,
    url,
  });
}

async function safeDrain(response: Response): Promise<void> {
  try {
    if (!response.body) return;
    await response.body.cancel();
  } catch {
    // Best-effort: ignore drain failures.
  }
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  url: string
): Promise<{ text: string; bytes: number }> {
  if (!response.body) {
    return { text: '', bytes: 0 };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new WebFetchException({
        kind: 'oversized',
        message: `Response exceeded ${maxBytes} bytes`,
        url,
      });
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: decoder.decode(merged), bytes: total };
}

function looksLikeHtml(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.includes('text/html') || ct.includes('application/xhtml');
}

/**
 * Convenience helper that converts a sanitization warning list to a
 * short text footer for tool results, so the agent sees a hint about
 * what was filtered.
 */
export function summarizeWarnings(warnings: SanitizationWarning[]): string {
  if (warnings.length === 0) return '';
  return warnings.map((w) => `[${w.kind}] ${w.detail}`).join('\n');
}