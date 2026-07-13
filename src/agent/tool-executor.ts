/**
 * Tool Executor — parallel batching for concurrencySafe tools
 */

import { ToolCall, ToolDefinition, ToolResult } from '../pkg/types.js';

export interface ToolExecutionOutcome {
  toolCall: ToolCall;
  result: ToolResult;
}

export interface ExecuteToolCallsOptions {
  toolCalls: ToolCall[];
  getDefinition: (name: string) => ToolDefinition | undefined;
  executeOne: (toolCall: ToolCall) => Promise<ToolResult>;
}

/**
 * 按原始顺序执行工具；连续 concurrencySafe 的工具并行执行。
 */
export async function executeToolCallsInOrder(
  options: ExecuteToolCallsOptions
): Promise<ToolExecutionOutcome[]> {
  const { toolCalls, getDefinition, executeOne } = options;
  const outcomes: ToolExecutionOutcome[] = [];
  let index = 0;

  while (index < toolCalls.length) {
    const safeBatch: ToolCall[] = [];

    while (index < toolCalls.length) {
      const call = toolCalls[index]!;
      const def = getDefinition(call.name);
      if (def?.concurrencySafe) {
        safeBatch.push(call);
        index++;
      } else {
        break;
      }
    }

    if (safeBatch.length > 0) {
      const batchResults = await Promise.all(safeBatch.map((call) => executeOne(call)));
      safeBatch.forEach((call, i) => {
        outcomes.push({ toolCall: call, result: batchResults[i]! });
      });
      continue;
    }

    const call = toolCalls[index]!;
    const result = await executeOne(call);
    outcomes.push({ toolCall: call, result });
    index++;
  }

  return outcomes;
}
