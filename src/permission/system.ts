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
import { matchPermissionRules, PermissionRules } from './rules.js';
import { classifyToolCall } from './classifier.js';
import { checkToolPermissionGate } from './tool-gate.js';

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

  check(request: PermissionCheckRequest): PermissionCheckResult {
    const { tool, mode } = request;

    // Layer 1: Rule engine (deny-first)
    const ruleResult = matchPermissionRules(tool, this.rules);
    if (ruleResult) return ruleResult;

    const definition = this.getToolDefinition?.(tool.name);

    if (mode === PermissionMode.PLAN) {
      return { allowed: false, reason: 'Plan mode: no execution' };
    }

    // Layer 4: tool.permissionMode 门禁
    const toolGate = checkToolPermissionGate(mode, definition?.permissionMode);
    if (toolGate) return toolGate;

    switch (mode) {
      case PermissionMode.BYPASS:
        return { allowed: true };
      case PermissionMode.DEFAULT:
        return { allowed: true, requiresInteraction: true, interactionType: 'confirm' };
      case PermissionMode.AUTO:
        return this.checkAutoMode(tool, definition);
      case PermissionMode.ACCEPT_EDITS:
        if (['Edit', 'Write', 'Read', 'Glob', 'Grep'].includes(tool.name)) return { allowed: true };
        return { allowed: true, requiresInteraction: true, interactionType: 'confirm' };
      case PermissionMode.DONT_ASK:
        if (this.isDestructive(tool)) return { allowed: false, reason: 'Destructive operation' };
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

  private isDestructive(tool: ToolCall): boolean {
    if (tool.name === 'Bash') {
      const cmd = String(tool.input['command'] ?? '');
      return /\b(rm\s+-rf|DROP\s+TABLE|git\s+push\s+--force)\b/i.test(cmd);
    }
    return false;
  }
}
