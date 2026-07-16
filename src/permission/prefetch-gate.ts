/**
 * Prefetch 权限门控：与主循环同一 PermissionSystem，交互确认整批只问一次
 * （并行 worker 共用同一个 Promise，避免竞态多次弹窗）
 */

import { PermissionMode, SessionState, ToolCall, ToolResult } from '../pkg/types.js';
import { PermissionSystem } from './system.js';
import { hasSessionApproval, rememberSessionApprovals } from './session-memory.js';

export type PrefetchPermissionPrompt = (
  tool: ToolCall,
  batchTools?: ToolCall[]
) => Promise<boolean>;

/** 批确认状态：并行安全 */
export interface PrefetchBatchConfirm {
  promise: Promise<boolean> | null;
  tools: ToolCall[];
}

export interface PrefetchAuthContext {
  permissionSystem: PermissionSystem;
  mode: PermissionMode;
  state: SessionState;
  prompt: PrefetchPermissionPrompt;
  shouldAbort?: () => boolean;
  batchConfirm: PrefetchBatchConfirm;
}

function denied(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

function needsUserConfirm(tool: ToolCall, ctx: PrefetchAuthContext): boolean {
  if (hasSessionApproval(ctx.state, tool)) return false;
  const d = ctx.permissionSystem.check({
    tool,
    mode: ctx.mode,
    context: ctx.state,
  });
  return d.allowed && Boolean(d.requiresInteraction);
}

/** 对单次预取工具调用做权限判定；拒绝时返回 ToolResult，放行返回 null */
export async function authorizePrefetchTool(
  tool: ToolCall,
  ctx: PrefetchAuthContext
): Promise<ToolResult | null> {
  const decision = ctx.permissionSystem.check({
    tool,
    mode: ctx.mode,
    context: ctx.state,
  });

  if (!decision.allowed) {
    return denied(`Permission denied: ${decision.reason ?? 'unknown'}`);
  }

  if (!decision.requiresInteraction || hasSessionApproval(ctx.state, tool)) {
    return null;
  }

  if (!ctx.batchConfirm.promise) {
    ctx.batchConfirm.promise = (async () => {
      if (ctx.shouldAbort?.()) return false;
      const needingConfirm = ctx.batchConfirm.tools.filter((t) => needsUserConfirm(t, ctx));
      if (needingConfirm.length === 0) return true;
      const batchTools = needingConfirm.length > 1 ? needingConfirm : undefined;
      const ok = await ctx.prompt(tool, batchTools);
      if (ok) {
        rememberSessionApprovals(ctx.state, needingConfirm);
      }
      return ok;
    })();
  }

  const confirmed = await ctx.batchConfirm.promise;
  if (ctx.shouldAbort?.()) {
    return denied('Interrupted during permission prompt');
  }
  if (!confirmed) {
    return denied('User denied permission for prefetch batch');
  }

  return null;
}
