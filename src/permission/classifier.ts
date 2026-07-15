/**
 * Deterministic permission classifier for AUTO mode
 */

import { ToolCall, ToolDefinition } from '../pkg/types.js';
import { checkBashSecurity } from '../tools/bash-secure.js';

/** 只读工具：AUTO 模式下免确认。Grep 已改为 execFile('rg', [...]) 参数化执行。 */
const READONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'TodoWrite']);

export type RiskLevel = 'safe' | 'moderate' | 'destructive';

export interface ClassificationResult {
  risk: RiskLevel;
  reason?: string;
}

/** 对工具调用做确定性风险分类 */
export function classifyToolCall(
  tool: ToolCall,
  _definition?: ToolDefinition
): ClassificationResult {
  if (READONLY_TOOLS.has(tool.name)) {
    return { risk: 'safe' };
  }

  if (tool.name === 'Bash') {
    const command = String(tool.input['command'] ?? '');
    const check = checkBashSecurity(command);
    if (!check.safe) {
      return { risk: 'destructive', reason: check.reason };
    }
    if (check.category === 'readonly') {
      return { risk: 'safe' };
    }
    return { risk: 'moderate', reason: 'Unclassified bash command' };
  }

  if (['Edit', 'Write'].includes(tool.name)) {
    return { risk: 'moderate', reason: 'File mutation' };
  }

  if (tool.name === 'Task' || tool.name.startsWith('mcp__')) {
    return { risk: 'moderate', reason: 'External execution' };
  }

  return { risk: 'moderate', reason: 'Unknown tool' };
}
