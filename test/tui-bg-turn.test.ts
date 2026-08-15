/**
 * K7 Ink TUI — 后台 turn 路由测试
 *
 * 验证:
 *   - /btw 路由被 handleTuiSlash 命中
 *   - 缺 bgTurnFn 时给提示而不是直接执行
 *   - 提供 bgTurnFn 时,把 prompt 透传过去
 */

import { describe, it, expect, vi } from 'vitest';
import { handleTuiSlash } from '../src/cli/tui/slash.js';
import type { TuiController } from '../src/cli/tui/app.js';
import { PermissionMode, type SessionState } from '../src/pkg/types.js';
import type { OutputStyle } from '../src/cli/output-styles.js';

function mockCtl(): TuiController & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    appendUser: (t) => lines.push(`U:${t}`),
    appendSystem: (t) => lines.push(`S:${t}`),
    appendError: (t) => lines.push(`E:${t}`),
    appendTool: (n, d) => lines.push(`T:${n}:${d ?? ''}`),
    appendAssistantDelta: (t) => lines.push(`A:${t}`),
    setBusy: () => undefined,
    setStatus: () => undefined,
    setProgressPhase: () => undefined,
    setLiveTasks: () => undefined,
    setToolRunning: () => undefined,
    addTokens: () => undefined,
    askConfirm: async () => true,
    askText: async () => '',
    setMode: () => undefined,
    requestInterrupt: () => undefined,
    injectText: () => undefined,
  };
}

const baseCtx = (extra: Record<string, unknown> = {}) => {
  const session = {
    sessionId: 't1',
    messages: [],
    mode: PermissionMode.DEFAULT,
  } as unknown as SessionState;
  return {
    ctl: mockCtl(),
    session,
    model: 'm',
    apiKeyPresent: true,
    tokenUsage: { input: 0, output: 0 },
    outputStyle: 'default' as OutputStyle,
    setOutputStyle: () => undefined,
    ...extra,
  };
};

describe('TUI background turn routing', () => {
  it('/btw without prompt shows usage', async () => {
    const ctx = baseCtx();
    const handled = await handleTuiSlash('/btw', ctx);
    expect(handled).toBe(true);
    expect(ctx.ctl.lines.some((l) => l.includes('Usage:'))).toBe(true);
  });

  it('/btw without bgTurnFn gives fallback hint (no execution)', async () => {
    const ctx = baseCtx();
    const handled = await handleTuiSlash('/btw build a hello world', ctx);
    expect(handled).toBe(true);
    expect(ctx.ctl.lines.some((l) => /no background runner/.test(l))).toBe(true);
  });

  it('/btw with bgTurnFn forwards prompt and does not grab focus', async () => {
    const bgSpy = vi.fn().mockResolvedValue(undefined);
    const ctx = baseCtx({ bgTurnFn: bgSpy });
    const handled = await handleTuiSlash('/btw explore repo', ctx);
    expect(handled).toBe(true);
    expect(bgSpy).toHaveBeenCalledWith('explore repo');
    // 不抢焦点:没有 appendUser 调用
    expect(ctx.ctl.lines.filter((l) => l.startsWith('U:')).length).toBe(0);
  });

  it('/tui confirms default with opt-out hint', async () => {
    const ctx = baseCtx();
    const handled = await handleTuiSlash('/tui', ctx);
    expect(handled).toBe(true);
    expect(ctx.ctl.lines.some((l) => /PACODE_LEGACY_REPL/.test(l))).toBe(true);
  });
});