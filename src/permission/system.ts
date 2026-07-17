/**
 * Permission System - 7 modes + rule engine + AUTO classifier
 */

import {
  PermissionMode,
  PermissionCheckRequest,
  PermissionCheckResult,
  ToolCall,
  ToolDefinition,
} from '../pkg/types.js';
import { matchDenyRules, matchAllowAskRules, PermissionRules } from './rules.js';
import { classifyToolCall } from './classifier.js';
import { checkToolPermissionGate } from './tool-gate.js';
import { checkBashSecurity, shouldHardBlockBashExecution } from '../tools/bash-secure.js';

/** PLAN 模式仅允许只读调研 + 进出 plan 的工具（engine 暴露同一白名单） */
export const PLAN_ALLOWED_TOOLS = new Set([
  'ExitPlanMode',
  'EnterPlanMode',
  'AskUser',
  'Read',
  'Glob',
  'Grep',
  'TodoWrite',
]);

export interface PermissionSystemOptions {
  rules?: PermissionRules;
  getToolDefinition?: (name: string) => ToolDefinition | undefined;
}

export class PermissionSystem {
  private rules?: PermissionRules;
  private getToolDefinition?: (name: string) => ToolDefinition | undefined;

  constructor(options: PermissionSystemOptions = {}) {
    this.rules = options.rules;
    this.getToolDefinition = options.getToolDefinition;
  }

  getRules(): PermissionRules | undefined {
    return this.rules;
  }

  check(request: PermissionCheckRequest): PermissionCheckResult {
    const { tool, mode } = request;

    // Layer 1: deny 规则（始终生效）
    const denyResult = matchDenyRules(tool, this.rules);
    if (denyResult) return denyResult;

    // Layer 2: PLAN — 默认禁执行；白名单工具可继续（ExitPlanMode 等）
    if (mode === PermissionMode.PLAN && !PLAN_ALLOWED_TOOLS.has(tool.name)) {
      return { allowed: false, reason: 'Plan mode: no execution' };
    }

    const allowAskResult = matchAllowAskRules(tool, this.rules);
    if (allowAskResult) return allowAskResult;

    const definition = this.getToolDefinition?.(tool.name);

    // Layer 4: tool.permissionMode 门禁（PLAN 白名单工具跳过，否则 Read@DEFAULT 会被 PLAN 会话挡住）
    const skipGate =
      mode === PermissionMode.PLAN && PLAN_ALLOWED_TOOLS.has(tool.name);
    const toolGate = skipGate
      ? null
      : checkToolPermissionGate(mode, definition?.permissionMode);
    if (toolGate) return toolGate;

    switch (mode) {
      case PermissionMode.BYPASS:
        return { allowed: true };
      case PermissionMode.PLAN:
        // 只读免确认；ExitPlanMode / AskUser 需确认
        if (['Read', 'Glob', 'Grep', 'TodoWrite'].includes(tool.name)) {
          return { allowed: true };
        }
        return { allowed: true, requiresInteraction: true, interactionType: 'confirm' };
      case PermissionMode.DEFAULT: {
        const classification = classifyToolCall(tool, definition);
        if (classification.risk === 'safe') {
          return { allowed: true };
        }
        if (classification.risk === 'destructive') {
          return { allowed: false, reason: classification.reason ?? 'Destructive operation' };
        }
        return { allowed: true, requiresInteraction: true, interactionType: 'confirm' };
      }
      case PermissionMode.AUTO:
        return this.checkAutoMode(tool, definition);
      case PermissionMode.ACCEPT_EDITS:
        if (
          ['Edit', 'Write', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'AskUser'].includes(
            tool.name
          )
        ) {
          return { allowed: true };
        }
        return { allowed: true, requiresInteraction: true, interactionType: 'confirm' };
      case PermissionMode.DONT_ASK:
        if (this.isDestructive(tool, definition)) {
          return {
            allowed: false,
            reason: 'Destructive operation',
          };
        }
        return { allowed: true };
      case PermissionMode.BUBBLE:
        return { allowed: true };
      default:
        return { allowed: false, reason: 'Unknown mode' };
    }
  }

  /** AUTO：确定性分类器决定是否需要确认 */
  private checkAutoMode(tool: ToolCall, definition?: ToolDefinition): PermissionCheckResult {
    const classification = classifyToolCall(tool, definition);

    if (classification.risk === 'destructive') {
      return { allowed: false, reason: classification.reason ?? 'Destructive operation blocked' };
    }

    if (classification.risk === 'safe') {
      return { allowed: true };
    }

    return { allowed: true, requiresInteraction: true, interactionType: 'confirm' };
  }

  /** DONT_ASK：走 bash-secure / classifier，不靠简陋正则 */
  private isDestructive(tool: ToolCall, definition?: ToolDefinition): boolean {
    if (tool.name === 'Bash') {
      const cmd = String(tool.input['command'] ?? '');
      const check = checkBashSecurity(cmd);
      if (check.safe) return false;
      if (check.category === 'destructive') return true;
      if (shouldHardBlockBashExecution(check)) return true;
      return false;
    }
    return classifyToolCall(tool, definition).risk === 'destructive';
  }
}
