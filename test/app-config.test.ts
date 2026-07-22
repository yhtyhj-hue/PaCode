/**
 * App config resolver tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAppConfig } from '../src/pkg/app-config.js';
import { resetConfigCache } from '../src/pkg/config/index.js';
import { SettingsManager } from '../src/pkg/settings/index.js';
import { PermissionMode } from '../src/pkg/types.js';
import { resetCCSwitch } from '../src/pkg/ccswitch/index.js';
import { mkdtempSync } from 'node:fs';

describe('resolveAppConfig', () => {
  let projectDir: string;
  let configPath: string;

  beforeEach(() => {
    projectDir = join(tmpdir(), `pacode-appcfg-${Date.now()}-${Math.random()}`);
    mkdirSync(projectDir, { recursive: true });
    configPath = join(projectDir, 'config.json');
    resetConfigCache();
  });

  afterEach(() => {
    resetConfigCache();
    if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
  });

  it('CLI flags override settings and config file', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        model: { model: 'from-config', maxTokens: 4096, temperature: 0.5 },
        permission: { mode: 'default' },
        context: { maxTokens: 100000, compactionThreshold: 0.9 },
      })
    );

    const settings = new SettingsManager(projectDir);
    settings.save({ model: 'from-settings', mode: PermissionMode.AUTO }, 'project');

    const cfg = resolveAppConfig(
      { model: 'cli-model', mode: 'plan' },
      { configPath, settingsManager: settings }
    );

    expect(cfg.model).toBe('cli-model');
    expect(cfg.mode).toBe(PermissionMode.PLAN);
    expect(cfg.compactionThreshold).toBe(0.9);
    expect(cfg.contextMaxTokens).toBe(100000);
  });

  it('uses config file values when CLI flags omitted', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        model: { model: 'file-model', maxTokens: 12000, temperature: 0.2 },
        context: { compactionThreshold: 0.77 },
      })
    );

    const cfg = resolveAppConfig({}, { configPath, settingsManager: new SettingsManager(projectDir) });
    expect(cfg.model).toBe('file-model');
    expect(cfg.maxTokens).toBe(12000);
    expect(cfg.compactionThreshold).toBe(0.77);
  });

  it('falls back to MiniMax defaults when empty', () => {
    const prevHome = process.env['HOME'];
    const prevModel = process.env['CLAUDE_MODEL'];
    const prevPacode = process.env['PACODE_MODEL'];
    const prevBase = process.env['ANTHROPIC_BASE_URL'];
    const prevPacodeBase = process.env['PACODE_BASE_URL'];
    const prevKey = process.env['ANTHROPIC_API_KEY'];
    const prevPacodeKey = process.env['PACODE_API_KEY'];

    const fakeHome = mkdtempSync(join(tmpdir(), 'pacode-home-'));
    process.env['HOME'] = fakeHome;
    delete process.env['CLAUDE_MODEL'];
    delete process.env['PACODE_MODEL'];
    delete process.env['ANTHROPIC_BASE_URL'];
    delete process.env['PACODE_BASE_URL'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['PACODE_API_KEY'];
    resetCCSwitch();

    writeFileSync(configPath, JSON.stringify({}));
    const cfg = resolveAppConfig({}, { configPath, settingsManager: new SettingsManager(projectDir) });
    expect(cfg.model).toBe('MiniMax-M3');
    expect(cfg.baseUrl).toBe('https://api.minimaxi.com/anthropic');

    if (prevHome !== undefined) process.env['HOME'] = prevHome;
    else delete process.env['HOME'];
    if (prevModel !== undefined) process.env['CLAUDE_MODEL'] = prevModel;
    if (prevPacode !== undefined) process.env['PACODE_MODEL'] = prevPacode;
    if (prevBase !== undefined) process.env['ANTHROPIC_BASE_URL'] = prevBase;
    if (prevPacodeBase !== undefined) process.env['PACODE_BASE_URL'] = prevPacodeBase;
    if (prevKey !== undefined) process.env['ANTHROPIC_API_KEY'] = prevKey;
    if (prevPacodeKey !== undefined) process.env['PACODE_API_KEY'] = prevPacodeKey;
    resetCCSwitch();
    if (existsSync(fakeHome)) rmSync(fakeHome, { recursive: true, force: true });
  });
});
