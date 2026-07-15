/** Brave Search API implementation for the WebSearch tool. */

import {
  formatPreparedResults,
  sanitizeSearchResult,
} from './result-format.js';
import {
  WebSearchError,
  type SearchOptions,
  type WebSearchInput,
  type WebSearchResponse,
  type WebSearchResult,
} from './types.js';

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MOCK_URL = 'https://example.com/pacode/mock-search';

interface BraveResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  snippet?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateInput(input: WebSearchInput): WebSearchInput {
  if (!isRecord(input) || typeof input.query !== 'string' || input.query.trim().length === 0) {
    throw new WebSearchError('parse', 'query must be a non-empty string');
  }

  const query = input.query.trim();
  if (query.length > 2000) {
    throw new WebSearchError('parse', 'query must not exceed 2000 characters');
  }

  if (input.region !== undefined && (typeof input.region !== 'string' || input.region.trim().length === 0)) {
    throw new WebSearchError('parse', 'region must be a non-empty string when provided');
  }
  if (input.region?.includes('\r') || input.region?.includes('\n')) {
    throw new WebSearchError('parse', 'region contains invalid control characters');
  }

  const allowedRecency = [1, 7, 30, 365] as const;
  if (input.recency_days !== undefined && !allowedRecency.includes(input.recency_days)) {
    throw new WebSearchError('parse', 'recency_days must be one of 1, 7, 30, or 365');
  }

  return {
    query,
    ...(input.region ? { region: input.region.trim() } : {}),
    ...(input.recency_days !== undefined ? { recency_days: input.recency_days } : {}),
  };
}

function freshnessFor(days: WebSearchInput['recency_days']): string | undefined {
  if (days === 1) return 'pd';
  if (days === 7) return 'pw';
  if (days === 30) return 'pm';
  if (days === 365) return 'py';
  return undefined;
}

function getRawResult(value: unknown): { title: string; url: string; snippet: string } | null {
  if (!isRecord(value)) return null;
  const result = value as BraveResult;
  if (typeof result.title !== 'string' || typeof result.url !== 'string') return null;
  const snippetValue = typeof result.description === 'string' ? result.description : result.snippet;
  return {
    title: result.title,
    url: result.url,
    snippet: typeof snippetValue === 'string' ? snippetValue : 'No snippet available.',
  };
}

function createMockResults(query: string): WebSearchResult[] {
  const encodedQuery = encodeURIComponent(query);
  const raw = [
    {
      title: `[MOCK] Web search result for ${query}`,
      url: `${DEFAULT_MOCK_URL}?q=${encodedQuery}`,
      snippet: `[MOCK] BRAVE_API_KEY is not configured. No live search was performed for: ${query}`,
    },
  ];
  return raw.map(sanitizeSearchResult).filter((result): result is WebSearchResult => result !== null);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch (error: unknown) {
    const message = controller.signal.aborted ? `request timed out after ${timeoutMs}ms` : error instanceof Error ? error.message : String(error);
    throw new WebSearchError('network', message);
  } finally {
    clearTimeout(timer);
  }
}

function parseBravePayload(payload: unknown): WebSearchResult[] {
  if (!isRecord(payload) || !isRecord(payload.web) || !Array.isArray(payload.web.results)) {
    throw new WebSearchError('parse', 'Brave response did not contain web.results');
  }

  return payload.web.results
    .map(getRawResult)
    .filter((result): result is { title: string; url: string; snippet: string } => result !== null)
    .map(sanitizeSearchResult)
    .filter((result): result is WebSearchResult => result !== null);
}

/** Run one Brave query, or return clearly marked local results without a key. */
export async function search(input: WebSearchInput, options: SearchOptions = {}): Promise<WebSearchResponse> {
  const validated = validateInput(input);
  const apiKey = options.apiKey ?? process.env.BRAVE_API_KEY;

  if (!apiKey?.trim()) {
    const results = createMockResults(validated.query);
    return {
      query: validated.query,
      results,
      formatted: formatPreparedResults(results),
      isMock: true,
    };
  }

  const params = new URLSearchParams({ q: validated.query, count: '10' });
  if (validated.region) params.set('country', validated.region);
  const freshness = freshnessFor(validated.recency_days);
  if (freshness) params.set('freshness', freshness);

  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new WebSearchError('network', 'fetch is not available in this runtime');

  const response = await fetchWithTimeout(
    `${BRAVE_SEARCH_URL}?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey.trim(),
      },
    },
    fetcher,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  if (response.status === 429) {
    throw new WebSearchError('rate_limit', 'Brave Search rate limit exceeded', response.status);
  }
  if (!response.ok) {
    throw new WebSearchError('http_status', `Brave Search returned HTTP ${response.status}`, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error: unknown) {
    throw new WebSearchError('parse', error instanceof Error ? error.message : 'invalid JSON response');
  }

  const results = parseBravePayload(payload);
  return {
    query: validated.query,
    results,
    formatted: formatPreparedResults(results),
    isMock: false,
  };
}

/** Convenience alias for callers that want to emphasize the operation name. */
export const performWebSearch = search;

export async function searchResults(input: WebSearchInput, options?: SearchOptions): Promise<WebSearchResult[]> {
  return (await search(input, options)).results;
}

export { BRAVE_SEARCH_URL, DEFAULT_TIMEOUT_MS };
