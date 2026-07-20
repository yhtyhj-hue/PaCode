/**
 * M3 确定性会话度量 — 全文件 Read 比例（非 live 用户语料）
 *
 * 对「深读」场景下的 Read tool 调用：无 limit，或 limit 覆盖 fileBytes → full。
 * 套件在 fixture 工具史上跑 ≥90%；不声称真实用户会话。
 */

export interface M3ReadCall {
  path: string;
  /** 未设 = 全文件 */
  limit?: number;
  offset?: number;
}

export interface M3SessionScenario {
  id: string;
  /** 文件路径 → 行数（或字节代理） */
  fileSizes: Record<string, number>;
  reads: M3ReadCall[];
}

/** 单次 Read 是否计为全文件覆盖 */
export function isFullFileRead(call: M3ReadCall, fileSize: number): boolean {
  if (call.limit === undefined || call.limit === null) return true;
  const offset = call.offset ?? 0;
  return offset + call.limit >= fileSize;
}

/** 场景得分：有 Read 时 full/total；无 Read → 0 */
export function scoreDeepReadScenario(scenario: M3SessionScenario): number {
  if (scenario.reads.length === 0) return 0;
  let full = 0;
  for (const read of scenario.reads) {
    const size = scenario.fileSizes[read.path] ?? 0;
    if (size <= 0) continue;
    if (isFullFileRead(read, size)) full += 1;
  }
  return full / scenario.reads.length;
}

export function scoreDeepReadSuite(scenarios: M3SessionScenario[]): {
  passRate: number;
  scores: Array<{ id: string; score: number }>;
} {
  if (scenarios.length === 0) {
    return { passRate: 1, scores: [] };
  }
  const scores = scenarios.map((s) => ({
    id: s.id,
    score: scoreDeepReadScenario(s),
  }));
  // 场景通过：该场景 score === 1（所有 Read 全文件）
  const passed = scores.filter((s) => s.score >= 1).length;
  return { passRate: passed / scores.length, scores };
}

/** 内置 fixture 套件：9 全文件 + 1 浅读 → 期望 passRate=0.9 */
export function defaultM3FixtureSuite(): M3SessionScenario[] {
  const full: M3SessionScenario[] = Array.from({ length: 9 }, (_, i) => ({
    id: `full-${i + 1}`,
    fileSizes: { [`src/f${i + 1}.ts`]: 100 },
    reads: [{ path: `src/f${i + 1}.ts` }],
  }));
  const shallow: M3SessionScenario = {
    id: 'shallow-1',
    fileSizes: { 'src/big.ts': 200 },
    reads: [{ path: 'src/big.ts', limit: 20, offset: 0 }],
  };
  return [...full, shallow];
}
