/**
 * Prefetch 权限门控：与主循环同一 PermissionSystem，交互确认整批只问一次
 * （并行 worker 共用同一个 Promise，避免竞态多次弹窗）
 */

import { PermissionMode, SessionState, ToolCall, ToolResult } from '../pkg/types.js';
import { PermissionSystem } from './system.js';

export type PrefetchPermissionPrompt = (tool: ToolCall) => Promise<boolean>;

/** 批确认状态：并行安全 */
export interface PrefetchBatchConfirm {
  /** 进行中的确认 Promise；null 表示尚未发起 */
  promise: Promise<boolean> | null;
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

  if (!decision.requiresInteraction) {
    return null;
  }

  // 并行安全：第一个 caller 创建 promise，其余 await 同一份
  if (!ctx.batchConfirm.promise) {
    ctx.batchConfirm.promise = (async () => {
      if (ctx.shouldAbort?.()) return false;
      return ctx.prompt(tool);
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
