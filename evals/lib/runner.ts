/**
 * Eval case 执行辅助 — 包装计时与结果构造
 */

import {
  EvalCaseResult,
  EvalLane,
  meetsThreshold,
} from './types.js';

export interface RunEvalCaseOptions {
  id: string;
  lane: EvalLane;
  threshold?: number;
  run: () => void | Promise<void>;
}

/** 执行单个 eval case 并返回结构化结果 */
export async function runEvalCase(
  options: RunEvalCaseOptions
): Promise<EvalCaseResult> {
  const threshold = options.threshold ?? 1;
  const start = performance.now();
  let passed = false;
  let message: string | undefined;

  try {
    await options.run();
    passed = true;
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
    passed = false;
  }

  const durationMs = performance.now() - start;
  const score = passed ? 1 : 0;

  return {
    id: options.id,
    lane: options.lane,
    passed: meetsThreshold(score, threshold),
    score,
    threshold,
    message,
    durationMs,
  };
}

/** 打印 suite 摘要（CLI 友好） */
export function printSuiteSummary(
  lane: EvalLane,
  passed: number,
  total: number
): void {
  const rate = total === 0 ? 100 : Math.round((passed / total) * 100);
  console.log(`[eval:${lane}] ${passed}/${total} passed (${rate}%)`);
}
