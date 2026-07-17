/**
 * 二次质检残留：approvedKeys / ConfigTool apiKey / cron / hooks / format / background &
 */

import { describe, it, expect } from 'vitest';
import { approvalKey } from '../src/permission/session-memory.js';
import { PermissionMode } from '../src/pkg/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerConfigTool } from '../src/tools/config-tool.js';
import {
  checkBashSecurity,
  hasBareBackgroundAmpersand,
  shouldHardBlockBashExecution,
  createSecureBashExecutor,
} from '../src/tools/bash-secure.js';
import {
  parseScheduleIntervalMs,
  sanitizeCronPrompt,
  MIN_CRON_INTERVAL_MS,
} from '../src/services/cron/store.js';
import { parseHookArgv, HookRegistry } from '../src/hooks/registry.js';
import { HookType } from '../src/pkg/types.js';
import { formatDagResults } from '../src/services/agent-scheduler/format-results.js';
import { describePermissionMode } from '../src/permission/format-display.js';

describe('approvedKeys / approvalKey', () => {
  it('does not treat all Bash as one key', () => {
    expect(approvalKey({ id: '1', name: 'Bash', input: { command: 'npm test' } })).not.toBe(
      approvalKey({ id: '2', name: 'Bash', input: { command: 'git push origin main' } })
    );
  });
});

describe('ConfigTool apiKey project ban', () => {
  it('rejects apiKey write to project target', async () => {
    const reg = new ToolRegistry();
    registerConfigTool(reg);
    const result = await reg.execute(
      {
        id: '1',
        name: 'ConfigTool',
        input: { action: 'set', key: 'apiKey', value: 'sk-test', target: 'project' },
      },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/cannot be written to project/i);
  });
});

describe('bash background & empty', () => {
  it('detects bare background ampersand but not 2>&1', () => {
    expect(hasBareBackgroundAmpersand('sleep 1 &')).toBe(true);
    expect(hasBareBackgroundAmpersand('npm test 2>&1')).toBe(false);
    expect(checkBashSecurity('sleep 1 &').category).toBe('destructive');
  });

  it('hard-blocks empty command', () => {
    const check = checkBashSecurity('');
    expect(check.category).toBe('destructive');
    expect(shouldHardBlockBashExecution(check)).toBe(true);
  });

  it('executor rejects background jobs', async () => {
    const exec = createSecureBashExecutor();
    const r = await exec('sleep 0 &');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/Background/i);
  });
});

describe('cron floor + sanitize', () => {
  it('rejects every:1ms and every:30s below floor', () => {
    expect(parseScheduleIntervalMs('every:1ms')).toBeNull();
    expect(parseScheduleIntervalMs('every:30s')).toBeNull();
    expect(parseScheduleIntervalMs('every:1m')).toBe(MIN_CRON_INTERVAL_MS);
  });

  it('sanitizeCronPrompt strips controls and truncates', () => {
    expect(sanitizeCronPrompt('hi\x00there')).toBe('hithere');
    const long = 'x'.repeat(5000);
    expect(sanitizeCronPrompt(long).length).toBeLessThan(4100);
    expect(sanitizeCronPrompt(long)).toContain('truncated');
  });
});

describe('hooks execFile argv', () => {
  it('parseHookArgv rejects shell metacharacters in string form', () => {
    const bad = parseHookArgv('echo ok; rm -rf /');
    expect('error' in bad).toBe(true);
  });

  it('parseHookArgv accepts simple argv', () => {
    const ok = parseHookArgv('echo hello');
    expect(ok).toEqual({ file: 'echo', args: ['hello'] });
  });

  it('HookRegistry refuses metachar command without executing shell', async () => {
    const reg = new HookRegistry();
    reg.register({
      name: 'evil',
      type: HookType.STOP,
      command: 'echo hi; echo pwned',
    });
    const result = await reg.execute(reg.getHooks()[0]!);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/metacharacters/i);
  });

  it('HookRegistry runs safe echo via execFile', async () => {
    const reg = new HookRegistry();
    reg.register({
      name: 'ok',
      type: HookType.SESSION_START,
      command: ['echo', 'hook-ok'],
    });
    const result = await reg.execute(reg.getHooks()[0]!);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hook-ok');
  });
});

describe('formatDagResults partial failure', () => {
  it('uses partial-failure header when some runs error', () => {
    const text = formatDagResults('inspect_project', [
      {
        tool: { id: '1', name: 'Bash', input: { command: 'npm test' } },
        result: { content: [{ type: 'text', text: 'fail' }], isError: true },
      },
      {
        tool: { id: '2', name: 'Read', input: { path: 'a.ts' } },
        result: { content: [{ type: 'text', text: 'ok' }] },
      },
    ]);
    expect(text).toMatch(/预取部分失败/);
    expect(text).not.toMatch(/项目检查已完成/);
  });
});

describe('permission copy', () => {
  it('DONT_ASK and PLAN descriptions mention real semantics', () => {
    expect(describePermissionMode(PermissionMode.DONT_ASK)).toMatch(/bash-secure/i);
    expect(describePermissionMode(PermissionMode.PLAN)).toMatch(/ExitPlanMode|read-only/i);
  });
});
