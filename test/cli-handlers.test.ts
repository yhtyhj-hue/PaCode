/**
 * CLI handlers + argument routing tests (C2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleMcp, handleInit, handleResume, handleCCSwitch, showHelp } from '../src/cli/handlers.js';
import { parseCliArgs, resolveCliRoute } from '../src/cli/args.js';
import { loadMcpConfig } from '../src/mcp/config.js';
import { SessionResume, resetSessionResume } from '../src/cli/resume.js';
import { PermissionMode } from '../src/pkg/types.js';
import { CCSwitchClient } from '../src/pkg/ccswitch/index.js';

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };

describe('parseCliArgs', () => {
  it('parses mode and message positionals', () => {
    const { values, positionals } = parseCliArgs(['-m', 'acceptEdits', 'hello', 'world']);
    expect(values.mode).toBe('acceptEdits');
    expect(positionals).toEqual(['hello', 'world']);
  });

  it('parses resume flags', () => {
    const { values } = parseCliArgs(['--resume', '--session-id', 'abc123']);
    expect(values.resume).toBe(true);
    expect(values['session-id']).toBe('abc123');
  });

  it('parses subcommand positionals', () => {
    const { positionals } = parseCliArgs(['mcp', 'list']);
    expect(positionals).toEqual(['mcp', 'list']);
  });
});

describe('resolveCliRoute', () => {
  it('routes subcommands', () => {
    expect(resolveCliRoute(['mcp', 'list'], {})).toBe('mcp');
    expect(resolveCliRoute(['init'], {})).toBe('init');
    expect(resolveCliRoute(['resume', 'list'], {})).toBe('resume');
    expect(resolveCliRoute(['worktree', 'list'], {})).toBe('worktree');
    expect(resolveCliRoute(['cc-switch', 'list'], {})).toBe('cc-switch');
    expect(resolveCliRoute(['ccs', 'status'], {})).toBe('cc-switch');
  });

  it('routes help/version before positionals', () => {
    expect(resolveCliRoute(['mcp'], { help: true })).toBe('help');
    expect(resolveCliRoute([], { version: true })).toBe('version');
  });

  it('defaults to agent route', () => {
    expect(resolveCliRoute([], {})).toBe('agent');
    expect(resolveCliRoute(['fix', 'bug'], {})).toBe('agent');
  });
});

describe('handleMcp', () => {
  let configPath: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    configPath = join(tmpdir(), `pacode-cli-mcp-${Date.now()}.json`);
    logSpy = (vi.spyOn(console, 'log').mockImplementation(() => {})) as unknown as ReturnType<typeof vi.spyOn>;
    errSpy = (vi.spyOn(console, 'error').mockImplementation(() => {})) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (existsSync(configPath)) rmSync(configPath, { force: true });
  });

  it('lists empty servers', async () => {
    await handleMcp(['list'], { configPath });
    expect(logSpy).toHaveBeenCalledWith('\nMCP Servers:');
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('No servers configured'))).toBe(
      true
    );
  });

  it('adds and removes a server', async () => {
    await handleMcp(['add', 'figma', 'npx', '-y', '@figma/mcp'], { configPath });
    const loaded = loadMcpConfig(configPath);
    expect(loaded.servers.figma?.command).toBe('npx');
    expect(loaded.servers.figma?.args).toEqual(['-y', '@figma/mcp']);

    await handleMcp(['remove', 'figma'], { configPath });
    expect(loadMcpConfig(configPath).servers.figma).toBeUndefined();
  });

  it('remove unknown server prints warning', async () => {
    await handleMcp(['remove', 'missing'], { configPath });
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Not found'))).toBe(true);
  });

  it('add without name exits via injectable exit', async () => {
    const exit = vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    }) as (code: number) => never;

    await expect(handleMcp(['add'], { configPath, exit })).rejects.toThrow('exit:1');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('unknown subcommand prints error and returns false', async () => {
    const result = await handleMcp(['bogus'], { configPath });
    expect(result).toBe(false);
    expect(errSpy).toHaveBeenCalledWith('Unknown mcp command: bogus');
  });
});

describe('handleInit', () => {
  let workDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'pacode-cli-init-'));
    logSpy = (vi.spyOn(console, 'log').mockImplementation(() => {})) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('creates .paude layout and CLAUDE.md when missing', async () => {
    await handleInit({ cwd: workDir });
    expect(existsSync(join(workDir, '.paude', 'memory'))).toBe(true);
    expect(existsSync(join(workDir, '.paude', 'sessions'))).toBe(true);
    const path = join(workDir, 'CLAUDE.md');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf-8')).toContain('# CLAUDE.md');
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Initialized .paude'))).toBe(true);
  });

  it('skips when CLAUDE.md exists', async () => {
    writeFileSync(join(workDir, 'CLAUDE.md'), '# existing\n', 'utf-8');
    await handleInit({ cwd: workDir });
    expect(readFileSync(join(workDir, 'CLAUDE.md'), 'utf-8')).toBe('# existing\n');
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('already exists'))).toBe(true);
  });
});

describe('handleResume', () => {
  let sessionsDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetSessionResume();
    sessionsDir = mkdtempSync(join(tmpdir(), 'pacode-cli-resume-'));
    logSpy = (vi.spyOn(console, 'log').mockImplementation(() => {})) as unknown as ReturnType<typeof vi.spyOn>;
    errSpy = (vi.spyOn(console, 'error').mockImplementation(() => {})) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    resetSessionResume();
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  function writeSession(id: string, messageCount = 2) {
    const session = {
      sessionId: id,
      mode: PermissionMode.DEFAULT,
      messages: Array.from({ length: messageCount }, (_, i) => ({
        role: 'user' as const,
        content: `msg-${i}`,
        timestamp: i,
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    writeFileSync(join(sessionsDir, `session_${id}.json`), JSON.stringify(session), 'utf-8');
  }

  it('lists saved sessions', async () => {
    writeSession('sess-a', 3);
    const resume = new SessionResume(sessionsDir);
    await handleResume(['list'], {}, { resume });
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Saved Sessions'))).toBe(true);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('sess-a'))).toBe(true);
  });

  it('lists empty when no sessions', async () => {
    const resume = new SessionResume(sessionsDir);
    await handleResume(['ls'], {}, { resume });
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('No saved sessions'))).toBe(true);
  });

  it('resumes by session id without starting REPL', async () => {
    writeSession('resume-me', 4);
    const resume = new SessionResume(sessionsDir);
    const startRepl = vi.fn(async () => {});

    await handleResume(['resume-me'], { 'api-key': 'test-key' }, { resume, startRepl });

    expect(startRepl).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Resuming session resume-me'))).toBe(
      true
    );
  });

  it('exits when no session available', async () => {
    const resume = new SessionResume(sessionsDir);
    const exit = vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    }) as (code: number) => never;

    await expect(handleResume([], {}, { resume, exit })).rejects.toThrow('exit:1');
    expect(errSpy).toHaveBeenCalledWith('No session to resume. Use: pacode resume list');
  });

  it('exits when session id not found', async () => {
    const resume = new SessionResume(sessionsDir);
    const exit = vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    }) as (code: number) => never;

    await expect(handleResume(['nope'], {}, { resume, exit })).rejects.toThrow('exit:1');
    expect(errSpy).toHaveBeenCalledWith('Session not found: nope');
  });

  it('resumes latest via --session-id flag', async () => {
    writeSession('flag-id', 1);
    const resume = new SessionResume(sessionsDir);
    const startRepl = vi.fn(async () => {});

    await handleResume([], { 'session-id': 'flag-id', 'api-key': 'k' }, { resume, startRepl });
    expect(startRepl).toHaveBeenCalledTimes(1);
  });
});

describe('showHelp', () => {
  it('prints usage text', () => {
    const spy = (vi.spyOn(console, 'log').mockImplementation(() => {})) as unknown as ReturnType<typeof vi.spyOn>;
    showHelp();
    const text = String(spy.mock.calls[0]?.[0] ?? '');
    expect(text).toContain('PaCode CLI');
    expect(text).toContain(`v${pkg.version}`);
    expect(text).toContain('worktree');
    expect(text).toContain('pacode mcp');
    expect(text).toContain('pacode init');
    spy.mockRestore();
  });
});

describe('handleCCSwitch', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let configPath: string;

  beforeEach(() => {
    configPath = join(tmpdir(), `pacode-ccs-${Date.now()}.json`);
    logSpy = (vi.spyOn(console, 'log').mockImplementation(() => {})) as unknown as ReturnType<typeof vi.spyOn>;
    errSpy = (vi.spyOn(console, 'error').mockImplementation(() => {})) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('lists providers', async () => {
    const cc = new CCSwitchClient(configPath);
    cc.addProvider({ name: 'p1', apiKey: 'k1', model: 'm1' });
    cc.switchTo('p1');

    await handleCCSwitch(['list'], {}, { cc });
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Providers'))).toBe(true);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('p1'))).toBe(true);
  });

  it('adds provider with api key', async () => {
    const cc = new CCSwitchClient(configPath);
    await handleCCSwitch(['add', 'new'], { 'api-key': 'secret-key' }, { cc });
    expect(cc.list().some((p) => p.name === 'new')).toBe(true);
  });

  it('shows status for active provider', async () => {
    const cc = new CCSwitchClient(configPath);
    cc.addProvider({ name: 'active', apiKey: '1234567890abcdef', active: true });
    await handleCCSwitch(['status'], {}, { cc });
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Active provider'))).toBe(true);
  });

  it('removes provider via handler', async () => {
    const cc = new CCSwitchClient(configPath);
    cc.addProvider({ name: 'gone', apiKey: 'k' });
    await handleCCSwitch(['remove', 'gone'], {}, { cc });
    expect(cc.list().some((p) => p.name === 'gone')).toBe(false);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Removed provider'))).toBe(true);
  });

  it('detect prints sources', async () => {
    const cc = new CCSwitchClient(configPath);
    await handleCCSwitch(['detect'], {}, { cc });
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Provider detection'))).toBe(true);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Claude Code import: disabled'))).toBe(
      true
    );
  });

  it('import is disabled', async () => {
    const cc = new CCSwitchClient(configPath);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await handleCCSwitch(['import'], {}, { cc, exit: () => {} });
    expect(result).toBe(false);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('CC import disabled'))).toBe(true);
    errSpy.mockRestore();
  });
});
