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

    // Layer 2: PLAN 模式 — 在 allow/ask 规则之前拦截，防止规则绕过
    if (mode === PermissionMode.PLAN) {
      return { allowed: false, reason: 'Plan mode: no execution' };
    }

    const allowAskResult = matchAllowAskRules(tool, this.rules);
    if (allowAskResult) return allowAskResult;

    const definition = this.getToolDefinition?.(tool.name);

    // Layer 4: tool.permissionMode 门禁
    const toolGate = checkToolPermissionGate(mode, definition?.permissionMode);
    if (toolGate) return toolGate;

    switch (mode) {
      case PermissionMode.BYPASS:
        return { allowed: true };
      case PermissionMode.DEFAULT: {
        // Claude Code 对齐：只读工具免确认；Bash/Edit 等需确认
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
