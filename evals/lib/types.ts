/**
 * Eval harness 共享类型
 */

export type EvalLane = 'gate' | 'periodic';

export interface EvalCaseResult {
  id: string;
  lane: EvalLane;
  passed: boolean;
  score: number;
  threshold: number;
  message?: string;
  durationMs: number;
}

export interface EvalSuiteReport {
  lane: EvalLane;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  results: EvalCaseResult[];
}

/** 汇总多个 case 结果为 suite 报告 */
export function buildSuiteReport(
  lane: EvalLane,
  results: EvalCaseResult[]
): EvalSuiteReport {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  return {
    lane,
    total,
    passed,
    failed: total - passed,
    passRate: total === 0 ? 1 : passed / total,
    results,
  };
}

/** 判定 score 是否达到 periodic eval 阈值 */
export function meetsThreshold(score: number, threshold: number): boolean {
  return score >= threshold;
}
