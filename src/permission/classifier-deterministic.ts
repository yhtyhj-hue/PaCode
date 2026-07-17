/**
 * G6/v0 deterministic risk classification (no ML)
 */

import { ToolCall, ToolDefinition } from '../pkg/types.js';
import { checkBashSecurity } from '../tools/bash-secure.js';
import {
  CLASSIFIER_CONTRACT,
  type ClassificationResult,
} from './classifier-contract.js';

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

const MUTATION_TOOLS = new Set([
  'Edit',
  'Write',
  'NotebookEdit',
  'ConfigTool',
]);

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

function audit(result: ClassificationResult, tool: ToolCall): void {
  if (process.env['PACODE_CLASSIFIER_AUDIT'] !== '1') return;
  console.error(
    `[classifier ${result.contract ?? CLASSIFIER_CONTRACT}] backend=${result.backend ?? 'deterministic'} ${tool.name} risk=${result.risk} category=${result.category ?? '?'} confidence=${result.confidence ?? '?'}${result.reason ? ` reason=${result.reason}` : ''}`
  );
}

function withMeta(
  partial: Omit<ClassificationResult, 'contract' | 'backend'>,
  tool: ToolCall
): ClassificationResult {
  const result: ClassificationResult = {
    ...partial,
    contract: CLASSIFIER_CONTRACT,
    backend: 'deterministic',
    confidence: partial.confidence ?? 'high',
  };
  audit(result, tool);
  return result;
}

/** Pure deterministic classifier used by the default backend */
export function classifyToolCallDeterministic(
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
