/** WebSearch service contracts. */

export type RecencyDays = 1 | 7 | 30 | 365;

export interface WebSearchInput {
  query: string;
  region?: string;
  recency_days?: RecencyDays;
}

/** A result after external content has been validated and rendered safe. */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  formatted: string;
  isMock: boolean;
}

export type WebSearchErrorCategory = 'network' | 'http_status' | 'parse' | 'rate_limit';

export interface SearchOptions {
  apiKey?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export class WebSearchError extends Error {
  readonly category: WebSearchErrorCategory;
  readonly status?: number;

  constructor(category: WebSearchErrorCategory, message: string, status?: number) {
    super(message);
    this.name = 'WebSearchError';
    this.category = category;
    this.status = status;
  }
}
