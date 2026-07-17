/**
 * M5 vs CC 时长断言
 *
 * 默认用套件墙钟（并行 mapPool 后的真实经历时间）；无墙钟时回退任务 duration 之和。
 * 阈值：PACODE_M5_SPEED_RATIO（默认 1.0）
 */

export interface DurationRow {
  durationMs?: number;
}

/** 任务 duration 之和（缺省视为 0） */
export function sumDurationMs(rows: DurationRow[]): number {
  return rows.reduce((acc, r) => acc + (r.durationMs ?? 0), 0);
}

/**
 * PaCode 是否达标：pacodeMs <= ccMs * ratio
 */
export function meetsSpeedRatio(
  pacodeMs: number,
  ccMs: number,
  ratio = resolveSpeedRatio()
): boolean {
  if (ccMs <= 0) return pacodeMs <= 0;
  return pacodeMs <= ccMs * ratio;
}

export function resolveSpeedRatio(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['PACODE_M5_SPEED_RATIO']?.trim();
  if (!raw) return 1.0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1.0;
}

/** 速度断言优先墙钟，否则用 sum */
export function resolveSpeedMetric(options: {
  pacodeWallMs?: number;
  ccWallMs?: number;
  pacodeSumMs: number;
  ccSumMs: number;
}): { pacodeMs: number; ccMs: number; metric: 'wall' | 'sum' } {
  if (
    options.pacodeWallMs != null &&
    options.ccWallMs != null &&
    options.pacodeWallMs >= 0 &&
    options.ccWallMs >= 0
  ) {
    return { pacodeMs: options.pacodeWallMs, ccMs: options.ccWallMs, metric: 'wall' };
  }
  return { pacodeMs: options.pacodeSumMs, ccMs: options.ccSumMs, metric: 'sum' };
}

export function formatSpeedAssert(
  pacodeMs: number,
  ccMs: number,
  ratio = resolveSpeedRatio(),
  metric: 'wall' | 'sum' = 'sum'
): string {
  const ok = meetsSpeedRatio(pacodeMs, ccMs, ratio);
  const limit = ccMs * ratio;
  return (
    `speed ${ok ? 'OK' : 'FAIL'} (${metric}): pacodeMs=${pacodeMs} ccMs=${ccMs} ` +
    `ratio=${ratio} limit=${Math.round(limit)}`
  );
}

/** 有限并发 map（顺序保留） */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: items.length === 0 ? 0 : limit }, () => worker()));
  return results;
}

export function resolveM5Concurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['PACODE_M5_CONCURRENCY']?.trim();
  // 默认 3：套件墙钟 ≈ max(task)；遇 429 时设 PACODE_M5_CONCURRENCY=1
  if (!raw) return 3;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 3;
}
