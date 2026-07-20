/**
 * Hook Loader — load hooks from hooks.json and config
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { Hook, HookType, SessionState } from '../pkg/types.js';
import { HookRegistry } from './registry.js';
import { parseStopHookDecision } from './hook-decision.js';
import { HookSchema } from '../pkg/config/index.js';
import { loadConfig } from '../pkg/config/index.js';
import { Logger } from '../pkg/logger/index.js';

export interface HooksFile {
  hooks?: Partial<Record<string, unknown[]>>;
}

const HOOK_TYPE_MAP: Record<string, HookType> = {
  PreToolUse: HookType.PRE_TOOL_USE,
  PostToolUse: HookType.POST_TOOL_USE,
  PostToolUseFailure: HookType.POST_TOOL_USE_FAILURE,
  PermissionRequest: HookType.PERMISSION_REQUEST,
  SessionStart: HookType.SESSION_START,
  SessionStop: HookType.SESSION_STOP,
  Notification: HookType.NOTIFICATION,
  SubagentStop: HookType.SUBAGENT_STOP,
  Stop: HookType.STOP,
};

export function findHookConfigPaths(): string[] {
  const cwd = process.cwd();
  return [
    resolve(cwd, '.paude/hooks.json'),
    resolve(cwd, '.claude/hooks.json'),
    join(homedir(), '.paude/hooks.json'),
    join(homedir(), '.claude/hooks.json'),
  ];
}

export function loadHooksFromFile(path: string): Hook[] {
  if (!existsSync(path)) return [];

  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as HooksFile;
    return parseHooksFile(raw);
  } catch {
    return [];
  }
}

export function loadAllHookDefinitions(): Hook[] {
  const seen = new Set<string>();
  const hooks: Hook[] = [];

  for (const path of findHookConfigPaths()) {
    for (const hook of loadHooksFromFile(path)) {
      const key = `${hook.type}:${hook.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hooks.push(hook);
    }
  }

  try {
    const config = loadConfig();
    const configHooks = config.hooks?.hooks;
    if (configHooks) {
      for (const hook of parseHooksFile({ hooks: configHooks as HooksFile['hooks'] })) {
        const key = `${hook.type}:${hook.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hooks.push(hook);
      }
    }
  } catch {
    /* config optional */
  }

  return hooks;
}

export function parseHooksFile(raw: HooksFile): Hook[] {
  const hooks: Hook[] = [];
  const groups = raw.hooks ?? {};

  for (const [typeName, entries] of Object.entries(groups)) {
    const hookType = HOOK_TYPE_MAP[typeName];
    if (!hookType || !Array.isArray(entries)) continue;

    for (const entry of entries) {
      const parsed = HookSchema.safeParse(entry);
      if (!parsed.success) continue;

      hooks.push({
        name: parsed.data.name,
        type: hookType,
        command: parsed.data.command,
        cwd: parsed.data.cwd,
        env: parsed.data.env,
        matcher: parsed.data.matcher,
      });
    }
  }

  return hooks;
}

/** 注册所有配置的 hooks 到 Registry */
export function bootstrapHooks(registry: HookRegistry): number {
  const log = new Logger({ prefix: 'HookLoader' });
  const hooks = loadAllHookDefinitions();

  for (const hook of hooks) {
    registry.register(hook);
  }

  if (hooks.length > 0) {
    log.info(`Loaded ${hooks.length} hook(s)`);
  }

  return hooks.length;
}

/** 触发 SessionStart / SessionStop 等非工具 hooks */
export async function runSessionHooks(
  registry: HookRegistry,
  type: HookType.SESSION_START | HookType.SESSION_STOP,
  session: SessionState
): Promise<void> {
  const ctx = {
    workingDirectory: process.cwd(),
    sessionState: session,
    hooks: registry,
  };

  const matching = registry.findMatching(type, ctx);
  for (const hook of matching) {
    await registry.execute(hook);
  }
}

/** H3: Stop hook — fires when an agent loop ends (any reason). */
export async function runStopHooks(
  registry: HookRegistry,
  session: SessionState
): Promise<{ stopped: boolean; reason?: string }> {
  const ctx = {
    workingDirectory: process.cwd(),
    sessionState: session,
    hooks: registry,
  };

  let stopped = false;
  let reason: string | undefined;

  const matching = registry.findMatching(HookType.STOP, ctx);
  for (const hook of matching) {
    try {
      const result = await registry.execute(hook);
      const decision = parseStopHookDecision(result.stdout ?? '');
      if (decision.kind === 'stop') {
        stopped = true;
        reason = decision.reason;
      }
    } catch {
      // Stop hook errors must never escape this loop
    }
  }

  // I1: auditable auto-memory — fire AFTER user-configured
  // Stop hooks so user hooks see the session, but extraction
  // errors never block the loop. Writes to
  // ~/.paude/memory/auto/<date>.jsonl (git-friendly diff/rollback).
  try {
    const { recordAutoMemory } = await import('../memory/auto-extract.js');
    await recordAutoMemory(session.messages);
  } catch {
    // Auto-memory failures must never propagate to REPL finally
  }

  return { stopped, reason };
}
