/**
 * Config loader tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, resetConfigCache } from '../src/pkg/config/index.js';

describe('loadConfig', () => {
  let projectDir: string;
  let configPath: string;

  beforeEach(() => {
    projectDir = join(tmpdir(), `pacode-cfg-${Date.now()}-${Math.random()}`);
    mkdirSync(projectDir, { recursive: true });
    configPath = join(projectDir, 'config.json');
    resetConfigCache();
  });

  afterEach(() => {
    resetConfigCache();
    if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
  });

  it('loads explicit config path', () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        model: { model: 'custom-model', maxTokens: 16000 },
        context: { compactionThreshold: 0.75 },
      })
    );

    const cfg = loadConfig(configPath);
    expect(cfg.model.model).toBe('custom-model');
    expect(cfg.model.maxTokens).toBe(16000);
    expect(cfg.context.compactionThreshold).toBe(0.75);
  });

  it('applies schema defaults for empty config file', () => {
    writeFileSync(configPath, '{}');
    const cfg = loadConfig(configPath);
    expect(cfg.model.model).toBe('MiniMax-M3');
    expect(cfg.context.compactionThreshold).toBe(0.83);
  });
});
