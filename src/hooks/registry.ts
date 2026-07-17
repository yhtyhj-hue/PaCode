/**
 * Hook Registry — execFile argv 执行，禁止 shell 元字符拼接
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Hook, HookType, ToolContext, HookResult } from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';

const execFileAsync = promisify(execFile);

/** 将 hook.command 解析为 execFile(file, args)；拒绝 shell 元字符 */
export function parseHookArgv(
  command: string | string[]
): { file: string; args: string[] } | { error: string } {
  const hasMeta = (s: string): boolean => /[;&|`$<>]/.test(s);

  if (Array.isArray(command)) {
    if (command.length === 0 || !command[0]?.trim()) {
      return { error: 'empty hook command' };
    }
    for (const part of command) {
      if (hasMeta(part)) {
        return { error: 'Hook command args must not contain shell metacharacters' };
      }
    }
    return { file: command[0]!, args: command.slice(1) };
  }

  const trimmed = command.trim();
  if (!trimmed) return { error: 'empty hook command' };
  if (hasMeta(trimmed)) {
    return {
      error:
        'Hook string command must not contain shell metacharacters; use command: string[]',
    };
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return { file: parts[0]!, args: parts.slice(1) };
}

export class HookRegistry {
  private hooks = new Map<string, Hook>();
  private log: Logger;

  constructor() {
    this.log = new Logger({ prefix: 'HookRegistry' });
  }

  register(hook: Hook): void {
    this.hooks.set(hook.name, hook);
    this.log.debug(`Registered: ${hook.name} (${hook.type})`);
  }

  unregister(name: string): boolean {
    return this.hooks.delete(name);
  }

  findMatching(type: HookType, ctx: ToolContext): Hook[] {
    return Array.from(this.hooks.values()).filter((h) => {
      if (h.type !== type) return false;
      if (h.matcher?.tool) {
        const toolName =
          ctx.currentTool?.name ?? ctx.sessionState.toolCallHistory.at(-1)?.name;
        if (toolName !== h.matcher.tool) return false;
      }
      return true;
    });
  }

  async execute(hook: Hook): Promise<HookResult> {
    const parsed = parseHookArgv(hook.command);
    if ('error' in parsed) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: parsed.error,
        blocked: false,
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(parsed.file, parsed.args, {
        cwd: hook.cwd ?? process.cwd(),
        timeout: 30000,
        env: hook.env ? { ...process.env, ...hook.env } : process.env,
        maxBuffer: 2 * 1024 * 1024,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (e) {
      const err = e as { code?: number; message?: string; stdout?: string; stderr?: string };
      return {
        exitCode: typeof err.code === 'number' ? err.code : 1,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? String(e),
        blocked: err.code === 2,
      };
    }
  }

  getHooks(): Hook[] {
    return Array.from(this.hooks.values());
  }

  clear(): void {
    this.hooks.clear();
  }
}
