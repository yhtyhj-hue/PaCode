import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isRetryableError,
  computeBackoff,
  withRetry,
  RetryAbortError,
} from '../src/agent/retry.js';

describe('isRetryableError', () => {
  it('returns true for 429 rate limit', () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
  });

  it('returns true for 529 overloaded', () => {
    expect(isRetryableError({ status: 529 })).toBe(true);
  });

  it('returns false for 401 auth error', () => {
    expect(isRetryableError({ status: 401 })).toBe(false);
  });

  it('returns false for 400 invalid request', () => {
    expect(isRetryableError({ status: 400 })).toBe(false);
  });

  it('returns true for ECONNRESET network errors', () => {
    expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('returns true for ETIMEDOUT', () => {
    expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('returns true for fetch failed message', () => {
    expect(isRetryableError({ message: 'fetch failed' })).toBe(true);
  });

  it('returns false for AbortError', () => {
    expect(isRetryableError({ name: 'AbortError' })).toBe(false);
  });

  it('returns true for 500/502/503 transient server errors', () => {
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 502 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
  });

  it('returns false for unknown errors', () => {
    expect(isRetryableError({ status: 418 })).toBe(false);
    expect(isRetryableError(new Error('random'))).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });

  it('respects custom retryable/non-retryable status overrides', () => {
    expect(isRetryableError({ status: 503 }, [503], [])).toBe(true);
    expect(isRetryableError({ status: 429 }, [], [429])).toBe(false);
  });
});

describe('computeBackoff', () => {
  it('grows exponentially with attempts', () => {
    const d1 = computeBackoff(1, 100, 10000);
    const d2 = computeBackoff(2, 100, 10000);
    const d3 = computeBackoff(3, 100, 10000);
    expect(d1).toBeGreaterThanOrEqual(100);
    expect(d2).toBeGreaterThanOrEqual(200);
    expect(d3).toBeGreaterThanOrEqual(400);
  });

  it('caps at maxDelayMs', () => {
    const d = computeBackoff(20, 100, 1000);
    // 100 * 2^19 = ~52M, must be capped at 1000 (+20% jitter)
    expect(d).toBeLessThanOrEqual(1200);
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the value on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { baseDelayMs: 10, maxDelayMs: 100 });
    // 让 setTimeout 跑完
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts', async () => {
    const err = { status: 429 };
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 });
    const expectation = expect(promise).rejects.toEqual(err);
    await vi.runAllTimersAsync().catch(() => {});
    await expectation;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable errors (e.g. 401)', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401 });
    await expect(withRetry(fn)).rejects.toEqual({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws RetryAbortError when signal is aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fn = vi.fn().mockResolvedValue('never');
    await expect(withRetry(fn, { signal: ctrl.signal })).rejects.toBeInstanceOf(RetryAbortError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('passes attempt number to fn', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await withRetry(fn);
    expect(fn).toHaveBeenCalledWith(1);
  });
});