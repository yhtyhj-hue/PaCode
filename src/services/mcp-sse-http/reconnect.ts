import { createHash } from 'node:crypto';

const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;
const DEFAULT_JITTER_RATIO = 0.2;
const DEFAULT_MAX_ATTEMPTS = 3;

export const RETRY_DEFAULTS = Object.freeze({
  baseDelayMs: DEFAULT_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  jitterRatio: DEFAULT_JITTER_RATIO,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
});

export class RetryAbortError extends Error {
  readonly cause?: unknown;

  constructor(message = 'MCP retry aborted', cause?: unknown) {
    super(message);
    this.name = 'RetryAbortError';
    this.cause = cause;
  }
}

export interface RetryContext {
  attempt: number;
  maxAttempts: number;
}

export interface RetryExecutionOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  signal?: AbortSignal;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  shouldRetry?: (error: unknown, context: RetryContext) => boolean;
}

export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  jitterRatio = DEFAULT_JITTER_RATIO,
  random = Math.random,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const safeBase = Math.max(0, baseDelayMs);
  const safeCap = Math.max(safeBase, maxDelayMs);
  const safeJitter = Math.max(0, Math.min(1, jitterRatio));
  const exponential = Math.min(safeCap, safeBase * 2 ** safeAttempt);
  const jitter = (random() * 2 - 1) * safeJitter;
  return Math.max(0, Math.min(safeCap, Math.round(exponential * (1 + jitter))));
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof RetryAbortError) {
    return false;
  }
  const status = getHttpStatus(error);
  if (status !== undefined) {
    return isRetryableStatus(status);
  }
  return true;
}

export function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === 'number') {
    return candidate.status;
  }
  if (typeof candidate.code === 'number' && candidate.code >= 100 && candidate.code <= 599) {
    return candidate.code;
  }
  return undefined;
}

export function isRetryAbortError(error: unknown): error is RetryAbortError {
  return error instanceof RetryAbortError;
}

export async function retryWithBackoff<T>(
  operation: (context: RetryContext) => Promise<T>,
  options: RetryExecutionOptions = {},
): Promise<T> {
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);
  const shouldRetry = options.shouldRetry ?? ((error: unknown) => isRetryableError(error));
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      return await operation({ attempt, maxAttempts });
    } catch (error: unknown) {
      lastError = error;
      const context = { attempt, maxAttempts };
      const canRetry = attempt + 1 < maxAttempts && shouldRetry(error, context);
      if (!canRetry) {
        throw error;
      }
      const delayMs = calculateBackoffDelay(
        attempt,
        options.baseDelayMs,
        options.maxDelayMs,
        options.jitterRatio,
        random,
      );
      try {
        await sleep(delayMs, options.signal);
      } catch (sleepError: unknown) {
        throw toRetryAbortError(sleepError);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function normalizeMaxAttempts(maxAttempts: number | undefined): number {
  if (maxAttempts === undefined || !Number.isFinite(maxAttempts)) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  return Math.max(1, Math.floor(maxAttempts));
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new RetryAbortError('MCP retry aborted', signal.reason);
  }
}

function toRetryAbortError(error: unknown): RetryAbortError {
  if (error instanceof RetryAbortError) {
    return error;
  }
  return new RetryAbortError('MCP retry aborted', error);
}

async function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (delayMs === 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const timer = setTimeout(() => finish(resolve), delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      finish(() => reject(new RetryAbortError('MCP retry aborted', signal?.reason)));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }
  });
}

export function stableHeaderKey(headers: RequestInit['headers'] | undefined): string {
  const normalized = new Headers(headers);
  const entries = Array.from(normalized.entries()).sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
