/**
 * Statusline 钩子 — PACODE_STATUSLINE_CMD 或 ~/.paude/statusline.sh
 *
 * 对标 CC ~/.claude/statusline.sh：stdin JSON，stdout 一行追加到状态栏。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PermissionMode } from '../pkg/types.js';

export interface StatuslineContext {
  mode: PermissionMode | string;
  tokens: number;
  model?: string;
  cwd?: string;
  sessionId?: string;
}

/** 解析可执行 statusline 命令；无则 null */
export function resolveStatuslineCommand(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string | null {
  const fromEnv = env['PACODE_STATUSLINE_CMD']?.trim();
  if (fromEnv) return fromEnv;
  const script = join(home, '.paude', 'statusline.sh');
  try {
    if (existsSync(script)) {
      accessSync(script, constants.X_OK);
      return script;
    }
  } catch {
    // 不可执行则忽略
  }
  return null;
}

/** 跑钩子；失败返回 ''（fail-open） */
export function runStatuslineHook(
  ctx: StatuslineContext,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string {
  const cmd = resolveStatuslineCommand(env, home);
  if (!cmd) return '';
  try {
    const payload = JSON.stringify({
      mode: ctx.mode,
      tokens: ctx.tokens,
      model: ctx.model ?? '',
      cwd: ctx.cwd ?? process.cwd(),
      sessionId: ctx.sessionId ?? '',
    });
    // shell:true 支持 "node script.js" 一类 env 命令
    const result = spawnSync(cmd, {
      input: payload,
      encoding: 'utf-8',
      timeout: 5_000,
      shell: true,
      env,
    });
    if (result.status !== 0) return '';
    const line = (result.stdout ?? '').trim().split('\n')[0] ?? '';
    return line.slice(0, 120);
  } catch {
    return '';
  }
}
