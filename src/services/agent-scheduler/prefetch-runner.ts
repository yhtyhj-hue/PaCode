/**
 * 带进度事件的 DAG 预取 — REPL 可逐条展示 + transcript 缓冲
 */

import { QueryEvent, ToolCall, ToolResult } from '../../pkg/types.js';
import { DagPlan } from './types.js';
import { DagExecuteFn, runDagPlanCollect } from './executor.js';

export type PrefetchRun = { tool: ToolCall; result: ToolResult };

/** 逐工具 yield prefetch_progress，最后 return 全部 runs */
export async function* runIntentPrefetch(
  plan: DagPlan,
  execute: DagExecuteFn
): AsyncGenerator<QueryEvent, PrefetchRun[], unknown> {
  const total = plan.nodes.length;
  const groups = [...new Set(plan.nodes.map((n) => n.group))].sort((a, b) => a - b);
  const runs: PrefetchRun[] = [];
  let seq = 0;

  for (const group of groups) {
    const batch = plan.nodes.filter((n) => n.group === group);
    const calls: ToolCall[] = batch.map((node) => {
      seq += 1;
      return {
        id: `dag_${node.id}_${seq}`,
        name: node.name,
        input: node.input,
      };
    });

    const results = await Promise.all(calls.map((call) => execute(call)));

    for (let i = 0; i < calls.length; i++) {
      const tool = calls[i]!;
      const result = results[i]!;
      runs.push({ tool, result });
      yield {
        type: 'prefetch_progress',
        tool,
        result,
        prefetchDone: runs.length,
        prefetchTotal: total,
      };
    }
  }

  return runs;
}

/** 测试/兼容：无进度回调时仍用 collect */
export { runDagPlanCollect };
