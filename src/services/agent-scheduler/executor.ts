/**
 * DAG 执行器 — 按 group 并行、组间串行
 */

import { ToolCall, ToolResult, QueryEvent } from '../../pkg/types.js';
import { DagPlan, DagNodeSpec } from './types.js';

let dagSeq = 0;

function toToolCall(node: DagNodeSpec): ToolCall {
  dagSeq += 1;
  return {
    id: `dag_${node.id}_${dagSeq}`,
    name: node.name,
    input: node.input,
  };
}

export type DagExecuteFn = (toolCall: ToolCall) => Promise<ToolResult>;

export async function runDagPlanCollect(
  plan: DagPlan,
  execute: DagExecuteFn
): Promise<Array<{ tool: ToolCall; result: ToolResult }>> {
  const runs: Array<{ tool: ToolCall; result: ToolResult }> = [];
  const groups = [...new Set(plan.nodes.map((n) => n.group))].sort((a, b) => a - b);

  for (const group of groups) {
    const batch = plan.nodes.filter((n) => n.group === group);
    const calls = batch.map((node) => toToolCall(node));
    const results = await Promise.all(calls.map((call) => execute(call)));

    for (let i = 0; i < calls.length; i++) {
      runs.push({ tool: calls[i]!, result: results[i]! });
    }
  }

  return runs;
}

/** 执行 DAG，yield UI 事件，return runs 供写入 session */
export async function* executeDagPlan(
  plan: DagPlan,
  execute: DagExecuteFn
): AsyncGenerator<QueryEvent, Array<{ tool: ToolCall; result: ToolResult }>, unknown> {
  const runs = await runDagPlanCollect(plan, execute);

  for (const { tool, result } of runs) {
    yield { type: 'tool_use', tool };
    yield { type: 'tool_result', tool, result };
  }

  return runs;
}

/** 测试用：重置 id 序列 */
export function resetDagSequence(): void {
  dagSeq = 0;
}
