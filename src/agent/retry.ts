/**
 * 指数退避重试 + 错误分类 — 用于 Anthropic API 调用等易受瞬时错误影响的网络操作
 */

/** 可重试错误：Anthropic 429 (rate limit)、529 (overloaded)、网络 ECONNRESET/ETIMEDOUT/ENOTFOUND 等 */
export interface RetryConfig {
  /** 最大尝试次数（含首次）。默认 3。 */
  maxAttempts?: number;
  /** 基础退避毫秒。默认 500。 */
  baseDelayMs?: number;
  /** 退避上限毫秒。默认 8000。 */
  maxDelayMs?: number;
  /** 可重试错误码（默认 ['rate_limit_error', 'overloaded_error']）。 */
  retryableStatus?: number[];
  /** 不可重试错误码（命中直接 throw）。默认 ['invalid_request_error', 'authentication_error']。 */
  nonRetryableStatus?: number[];
  /** 用户中断信号 — AbortSignal。触发后立即抛 AbortError。 */
  signal?: AbortSignal;
}

const DEFAULT_RETRYABLE = [429, 529];
const DEFAULT_NON_RETRYABLE = [400, 401, 403, 404];

export class RetryAbortError extends Error {
  constructor() {
    super('Operation aborted');
    this.name = 'RetryAbortError';
  }
}

/** 判断一个错误是否应触发重试 */
export function isRetryableError(
  err: unknown,
  retryable: number[] = DEFAULT_RETRYABLE,
  nonRetryable: number[] = DEFAULT_NON_RETRYABLE
): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; code?: string; message?: string; name?: string };

  if (e.name === 'AbortError' || e.name === 'RetryAbortError') return false;

  if (typeof e.status === 'number') {
    if (nonRetryable.includes(e.status)) return false;
    if (retryable.includes(e.status)) return true;
    return false;
  }

  // 网络层错误：ECONNRESET / ETIMEDOUT / ENOTFOUND / EAI_AGAIN / fetch failed
  const code = e.code?.toString() ?? '';
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED'
  ) {
    return true;
  }

  if (typeof e.message === 'string') {
    const msg = e.message.toLowerCase();
    if (msg.includes('fetch failed') || msg.includes('network')) return true;
  }

  return false;
}

/** 计算下次重试延迟（指数退避 + 抖动）。 */
export function computeBackoff(
  attempt: number,
  baseMs: number,
  maxMs: number
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  // 20% 抖动防止雪崩
  const jitter = exp * 0.2 * Math.random();
  return Math.floor(exp + jitter);
}

/** 带重试的执行包装。对返回 Promise 的工厂函数进行最多 maxAttempts 次重试。
 *  非可重试错误立即抛出；最后一次重试失败抛出原始错误。 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const maxAttempts = Math.max(1, config.maxAttempts ?? 3);
  const baseDelayMs = config.baseDelayMs ?? 500;
  const maxDelayMs = config.maxDelayMs ?? 8000;
  const retryable = config.retryableStatus ?? DEFAULT_RETRYABLE;
  const nonRetryable = config.nonRetryableStatus ?? DEFAULT_NON_RETRYABLE;
  const signal = config.signal;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new RetryAbortError();
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      if (!isRetryableError(err, retryable, nonRetryable)) throw err;
      const delay = computeBackoff(attempt, baseDelayMs, maxDelayMs);
      if (signal?.aborted) throw new RetryAbortError();
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}