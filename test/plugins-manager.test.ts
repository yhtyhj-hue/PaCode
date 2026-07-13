import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PluginManager } from '../src/plugins/manager.js';

describe('PluginManager', () => {
  let pluginsRoot: string;

  beforeEach(() => {
    pluginsRoot = join(tmpdir(), `pacode-pmgr-${Date.now()}`);
  });

  afterEach(() => {
    if (existsSync(pluginsRoot)) rmSync(pluginsRoot, { recursive: true, force: true });
  });

  it('returns empty when plugins dir missing', async () => {
    const manager = new PluginManager(join(pluginsRoot, 'missing'));
    const result = await manager.loadAll();
    expect(result.size).toBe(0);
    expect(manager.list()).toEqual([]);
  });

  it('skips directories without plugin.json', async () => {
    mkdirSync(join(pluginsRoot, 'bad-plugin'), { recursive: true });
    const manager = new PluginManager(pluginsRoot);
    await manager.loadAll();
    expect(manager.list()).toHaveLength(0);
  });

  it('loads valid plugin and getCommands', async () => {
    const dir = join(pluginsRoot, 'good');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'plugin.json'),
      JSON.stringify({
        name: 'good',
        version: '1.0.0',
        description: 'Good plugin',
        commands: ['run', 'help'],
      })
    );

    const manager = new PluginManager(pluginsRoot);
    await manager.loadAll();
    expect(manager.get('good')?.version).toBe('1.0.0');
    expect(manager.getCommands()).toEqual(['run', 'help']);
  });

  it('ignores invalid plugin json', async () => {
    const dir = join(pluginsRoot, 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), '{ invalid');

    const manager = new PluginManager(pluginsRoot);
    await manager.loadAll();
    expect(manager.list()).toHaveLength(0);
  });
});
