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
});
