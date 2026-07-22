/**
 * SettingsManager — .paude paths (not ~/.claude)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsManager } from '../src/pkg/settings/index.js';

describe('SettingsManager paude paths', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pacode-settings-'));
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('writes project/local under .paude/', () => {
    const mgr = new SettingsManager(dir);
    expect(mgr.pathFor('project')).toBe(join(dir, '.paude', 'settings.json'));
    expect(mgr.pathFor('local')).toBe(join(dir, '.paude', 'settings.local.json'));
    expect(mgr.pathFor('user')).toContain(join('.paude', 'settings.json'));

    mgr.save({ model: 'MiniMax-M3' }, 'local');
    const disk = JSON.parse(readFileSync(join(dir, '.paude', 'settings.local.json'), 'utf-8'));
    expect(disk.model).toBe('MiniMax-M3');
    expect(existsSync(join(dir, '.claude', 'settings.local.json'))).toBe(false);
  });
});
