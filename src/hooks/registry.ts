/**
 * Hook Registry
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Hook, HookType, ToolContext, HookResult } from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';

const execAsync = promisify(exec);

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
        const last = ctx.sessionState.toolCallHistory.at(-1);
        if (last?.name !== h.matcher.tool) return false;
      }
      return true;
    });
  }

  async execute(hook: Hook): Promise<HookResult> {
    try {
      const cmd = Array.isArray(hook.command) ? hook.command.join(' ') : hook.command;
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: hook.cwd ?? process.cwd(),
        timeout: 30000,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (e) {
      const err = e as { code?: number; message?: string };
      return {
        exitCode: err.code ?? 1,
        stdout: '',
        stderr: err.message ?? String(e),
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
