/**
 * G6/v0: Deterministic permission classifier for AUTO mode (not ML)
 */

import { ToolCall, ToolDefinition } from '../pkg/types.js';
import { checkBashSecurity } from '../tools/bash-secure.js';
import {
  CLASSIFIER_CONTRACT,
  type ClassifierCategory,
  type ClassifierConfidence,
} from './classifier-contract.js';

export { CLASSIFIER_CONTRACT } from './classifier-contract.js';

/** 只读工具：AUTO 模式下免确认 */
const READONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'TodoWrite',
  'Diagnostics',
  'LSP',
  'BashOutput',
  'TaskList',
  'TaskGet',
  'ToolSearch',
]);

/** 文件/状态变更：需确认 */
const MUTATION_TOOLS = new Set([
  'Edit',
  'Write',
  'NotebookEdit',
  'ConfigTool',
]);

/** 多代理 / 协作调度：需确认（非 destructive） */
const ORCHESTRATION_TOOLS = new Set([
  'Task',
  'TaskStop',
  'TeamCreate',
  'SendMessage',
  'Coordinator',
  'SkillTool',
  'ScheduleCron',
  'EnterPlanMode',
  'ExitPlanMode',
]);

export type RiskLevel = 'safe' | 'moderate' | 'destructive';

export interface ClassificationResult {
  risk: RiskLevel;
  reason?: string;
  contract?: typeof CLASSIFIER_CONTRACT;
  category?: ClassifierCategory;
  confidence?: ClassifierConfidence;
}

function audit(result: ClassificationResult, tool: ToolCall): void {
  if (process.env['PACODE_CLASSIFIER_AUDIT'] !== '1') return;
  // 核心：可选审计，不碰 secrets
  console.error(
    `[classifier ${CLASSIFIER_CONTRACT}] ${tool.name} risk=${result.risk} category=${result.category ?? '?'} confidence=${result.confidence ?? '?'}${result.reason ? ` reason=${result.reason}` : ''}`
  );
}

function withMeta(
  partial: Omit<ClassificationResult, 'contract'>,
  tool: ToolCall
): ClassificationResult {
  const result: ClassificationResult = {
    ...partial,
    contract: CLASSIFIER_CONTRACT,
    confidence: partial.confidence ?? 'high',
  };
  audit(result, tool);
  return result;
}

/** 对工具调用做确定性风险分类 */
export function classifyToolCall(
  tool: ToolCall,
  _definition?: ToolDefinition
): ClassificationResult {
  if (READONLY_TOOLS.has(tool.name)) {
    return withMeta({ risk: 'safe', category: 'readonly' }, tool);
  }

  if (tool.name === 'Bash' || tool.name === 'BashStop') {
    if (tool.name === 'BashStop') {
      return withMeta(
        { risk: 'moderate', category: 'bash', reason: 'Stop background bash' },
        tool
      );
    }
    const command = String(tool.input['command'] ?? '');
    const check = checkBashSecurity(command);
    if (!check.safe) {
      if (/requires confirmation/i.test(check.reason ?? '')) {
        return withMeta(
          { risk: 'moderate', category: 'bash', reason: check.reason },
          tool
        );
      }
      return withMeta(
        { risk: 'destructive', category: 'bash', reason: check.reason },
        tool
      );
    }
    if (check.category === 'readonly') {
      return withMeta({ risk: 'safe', category: 'readonly' }, tool);
    }
    return withMeta(
      { risk: 'moderate', category: 'bash', reason: 'Unclassified bash command' },
      tool
    );
  }

  if (MUTATION_TOOLS.has(tool.name)) {
    return withMeta(
      { risk: 'moderate', category: 'mutation', reason: 'File or config mutation' },
      tool
    );
  }

  if (ORCHESTRATION_TOOLS.has(tool.name) || tool.name.startsWith('mcp__')) {
    return withMeta(
      {
        risk: 'moderate',
        category: tool.name.startsWith('mcp__') ? 'external' : 'orchestration',
        reason: tool.name.startsWith('mcp__') ? 'External MCP tool' : 'Orchestration tool',
      },
      tool
    );
  }

  return withMeta(
    {
      risk: 'moderate',
      category: 'unknown',
      confidence: 'medium',
      reason: 'Unknown tool',
    },
    tool
  );
}
