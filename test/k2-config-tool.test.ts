/**
 * K2 — ConfigTool thin settings wrapper
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerConfigTool, redactSettings } from '../src/tools/config-tool.js';
import { registerCoreTools } from '../src/tools/bootstrap.js';
import { SettingsManager } from '../src/pkg/settings/index.js';

const ctx = {
  workingDirectory: process.cwd(),
  sessionState: {} as never,
  hooks: {} as never,
};

describe('K2 ConfigTool', () => {
  let dir: string;
  let mgr: SettingsManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pacode-k2-'));
    mgr = new SettingsManager(dir);
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('redacts apiKey', () => {
    expect(redactSettings({ apiKey: 'sk-secret' }).apiKey).toBe('(set)');
  });

  it('set/get round-trip on local layer', async () => {
    const reg = new ToolRegistry();
    registerConfigTool(reg, { settingsManager: mgr });

    const set = await reg.execute(
      {
        id: '1',
        name: 'ConfigTool',
        input: { action: 'set', key: 'model', value: 'claude-test', target: 'local' },
      },
      ctx
    );
    expect(set.isError).toBeFalsy();
    const setBody = JSON.parse((set.content[0] as { text: string }).text);
    expect(setBody.ok).toBe(true);
    expect(setBody.target).toBe('local');

    const disk = JSON.parse(
      readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf-8')
    );
    expect(disk.model).toBe('claude-test');

    const get = await reg.execute(
      { id: '2', name: 'ConfigTool', input: { action: 'get', key: 'model' } },
      ctx
    );
    const getBody = JSON.parse((get.content[0] as { text: string }).text);
    expect(getBody.settings).toBe('claude-test');
  });

  it('rejects non-writable keys', async () => {
    const reg = new ToolRegistry();
    registerConfigTool(reg, { settingsManager: mgr });
    const result = await reg.execute(
      {
        id: '1',
        name: 'ConfigTool',
        input: { action: 'set', key: 'hooks', value: {}, target: 'local' },
      },
      ctx
    );
    expect(result.isError).toBe(true);
  });

  it('list includes writable_keys and redacted resolved', async () => {
    mgr.mergeSet('apiKey', 'sk-abc', 'local');
    const reg = new ToolRegistry();
    registerConfigTool(reg, { settingsManager: mgr });
    const result = await reg.execute(
      { id: '1', name: 'ConfigTool', input: { action: 'list' } },
      ctx
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('writable_keys');
    expect(text).toContain('(set)');
    expect(text).not.toContain('sk-abc');
  });

  it('bootstrap registers ConfigTool without BriefTool', () => {
    const reg = new ToolRegistry();
    registerCoreTools(reg, { task: { toolRegistry: reg } });
    expect(reg.has('ConfigTool')).toBe(true);
    expect(reg.has('BriefTool')).toBe(false);
    expect(reg.list().length).toBeGreaterThanOrEqual(25);
  });
});
