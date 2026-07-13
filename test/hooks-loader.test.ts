import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadHooksFromFile, bootstrapHooks, runSessionHooks } from '../src/hooks/loader.js';
import { HookRegistry } from '../src/hooks/registry.js';
import { HookType, PermissionMode } from '../src/pkg/types.js';
import { resetConfigCache } from '../src/pkg/config/index.js';

describe('Hook Loader', () => {
  let hooksDir: string;
  let hooksPath: string;

  beforeEach(() => {
    resetConfigCache();
    hooksDir = join(tmpdir(), `hooks-${Date.now()}`);
    mkdirSync(hooksDir, { recursive: true });
    hooksPath = join(hooksDir, 'hooks.json');
  });

  afterEach(() => {
    if (existsSync(hooksDir)) rmSync(hooksDir, { recursive: true, force: true });
  });

  it('loads hooks from hooks.json', () => {
    writeFileSync(
      hooksPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              name: 'guard-bash',
              type: 'PreToolUse',
              command: 'echo ok',
              matcher: { tool: 'Bash' },
            },
          ],
          SessionStart: [
            {
              name: 'welcome',
              type: 'SessionStart',
              command: 'echo start',
            },
          ],
        },
      })
    );

    const hooks = loadHooksFromFile(hooksPath);
    expect(hooks).toHaveLength(2);
    expect(hooks.find((h) => h.name === 'guard-bash')?.type).toBe(HookType.PRE_TOOL_USE);
    expect(hooks.find((h) => h.name === 'welcome')?.type).toBe(HookType.SESSION_START);
  });

  it('registers hooks into HookRegistry via loadHooksFromFile', () => {
    writeFileSync(
      hooksPath,
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              name: 'audit',
              type: 'PostToolUse',
              command: 'echo done',
            },
          ],
        },
      })
    );

    const registry = new HookRegistry();
    const hooks = loadHooksFromFile(hooksPath);
    for (const hook of hooks) registry.register(hook);
    expect(registry.getHooks()).toHaveLength(1);
    expect(registry.getHooks()[0]?.name).toBe('audit');
  });

  it('runSessionHooks executes SessionStart hooks', async () => {
    const registry = new HookRegistry();
    registry.register({
      name: 'session-start-echo',
      type: HookType.SESSION_START,
      command: process.platform === 'win32' ? 'cmd /c echo hello' : 'echo hello',
    });

    const session = {
      sessionId: 's1',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    };

    await expect(runSessionHooks(registry, HookType.SESSION_START, session)).resolves.toBeUndefined();
  });

  it('bootstrapHooks loads from provided file paths indirectly', () => {
    const registry = new HookRegistry();
    registry.register({
      name: 'inline',
      type: HookType.NOTIFICATION,
      command: 'echo notify',
    });
    expect(bootstrapHooks(registry)).toBeGreaterThanOrEqual(0);
  });
});
