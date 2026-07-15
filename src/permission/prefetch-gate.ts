/**
 * Prefetch 权限门控：与主循环同一 PermissionSystem，交互确认整批只问一次
 * （并行 worker 共用同一个 Promise，避免竞态多次弹窗）
 *
 * 设计说明：engine 在创建 PrefetchBatchConfirm 时**预先填入**所有 DAG 节点的
 * ToolCall 到 tools 列表（不依赖 worker 后续 push），保证 prompt 触发时列表
 * 已完整。worker 调 authorizePrefetchTool 时只传单个 tool 用于决策，全列表
 * 传给 prompt 让 UI 显示完整批摘要。
 */

import { PermissionMode, SessionState, ToolCall, ToolResult } from '../pkg/types.js';
import { PermissionSystem } from './system.js';

export type PrefetchPermissionPrompt = (
  tool: ToolCall,
  batchTools?: ToolCall[]
) => Promise<boolean>;

/** 批确认状态：并行安全 */
export interface PrefetchBatchConfirm {
  /** 进行中的确认 Promise；null 表示尚未发起 */
  promise: Promise<boolean> | null;
  /**
   * 批内全部 tool 列表（engine 创建时预填）。
   * 长度 = 0 时表示单 tool 模式（无批）。
   */
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
  // 只把仍需确认的工具放进批摘要（Read/Glob 已在 DEFAULT 自动放行）
  if (!ctx.batchConfirm.promise) {
    ctx.batchConfirm.promise = (async () => {
      if (ctx.shouldAbort?.()) return false;
      const needingConfirm = ctx.batchConfirm.tools.filter((t) => {
        const d = ctx.permissionSystem.check({
          tool: t,
          mode: ctx.mode,
          context: ctx.state,
        });
        return d.allowed && Boolean(d.requiresInteraction);
      });
      const batchTools = needingConfirm.length > 1 ? needingConfirm : undefined;
      return ctx.prompt(tool, batchTools);
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
