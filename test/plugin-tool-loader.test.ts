/**
 * Plugin tool loader tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPluginTool,
  registerPluginTools,
  pluginToolName,
  unregisterPluginTools,
} from '../src/plugins/tool-loader.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('pluginToolName', () => {
  it('prefixes plugin and tool names', () => {
    expect(pluginToolName('example', 'greet')).toBe('plugin__example__greet');
  });
});

describe('loadPluginTool', () => {
  let pluginDir: string;

  beforeEach(() => {
    pluginDir = join(tmpdir(), `pacode-ptool-${Date.now()}`);
    mkdirSync(join(pluginDir, 'tools'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(pluginDir)) rmSync(pluginDir, { recursive: true, force: true });
  });

  it('loads template handler tool', async () => {
    writeFileSync(
      join(pluginDir, 'tools', 'greet.json'),
      JSON.stringify({
        name: 'greet',
        description: 'Say hello',
        handler: { type: 'template', template: 'Hi {{name}}!' },
      })
    );

    const tool = loadPluginTool(pluginDir, 'greet', 'demo');
    expect(tool?.name).toBe('plugin__demo__greet');
    expect(tool?.concurrencySafe).toBe(true);
    expect(tool?.permissionMode).toBe(PermissionMode.DEFAULT);

    const result = await tool!.execute({ name: 'PaCode' }, {} as never);
    expect((result.content[0] as { type: 'text'; text: string }).text).toBe('Hi PaCode!');
  });

  it('loads echo handler with static message', async () => {
    writeFileSync(
      join(pluginDir, 'tools', 'ping.json'),
      JSON.stringify({
        name: 'ping',
        description: 'Ping',
        handler: { type: 'echo', message: 'pong' },
      })
    );

    const tool = loadPluginTool(pluginDir, 'ping', 'demo');
    const result = await tool!.execute({}, {} as never);
    expect((result.content[0] as { type: 'text'; text: string }).text).toBe('pong');
  });

  it('returns null for missing file', () => {
    expect(loadPluginTool(pluginDir, 'missing', 'demo')).toBeNull();
  });
});

describe('registerPluginTools', () => {
  let pluginDir: string;
  let registry: ToolRegistry;

  beforeEach(() => {
    pluginDir = join(tmpdir(), `pacode-reg-tool-${Date.now()}`);
    mkdirSync(join(pluginDir, 'tools'), { recursive: true });
    registry = new ToolRegistry();
    writeFileSync(
      join(pluginDir, 'tools', 'a.json'),
      JSON.stringify({
        name: 'a',
        description: 'Tool A',
        handler: { type: 'echo', message: 'A' },
      })
    );
  });

  afterEach(() => {
    if (existsSync(pluginDir)) rmSync(pluginDir, { recursive: true, force: true });
  });

  it('registers tools into registry', () => {
    const count = registerPluginTools(registry, pluginDir, 'my-plugin', ['a']);
    expect(count).toBe(1);
    expect(registry.has('plugin__my-plugin__a')).toBe(true);
  });

  it('replaces tools on re-register', () => {
    registerPluginTools(registry, pluginDir, 'my-plugin', ['a']);
    writeFileSync(
      join(pluginDir, 'tools', 'a.json'),
      JSON.stringify({
        name: 'a',
        description: 'Tool A v2',
        handler: { type: 'echo', message: 'A2' },
      })
    );
    registerPluginTools(registry, pluginDir, 'my-plugin', ['a']);
    expect(registry.list().filter((t) => t.name.startsWith('plugin__my-plugin__'))).toHaveLength(1);
  });

  it('unregisterPluginTools removes plugin tools only', () => {
    registerPluginTools(registry, pluginDir, 'my-plugin', ['a']);
    registry.register({
      name: 'Read',
      description: 'read',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.DEFAULT,
      async execute() {
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      },
    });

    const removed = unregisterPluginTools(registry, 'my-plugin');
    expect(removed).toBe(1);
    expect(registry.has('Read')).toBe(true);
    expect(registry.has('plugin__my-plugin__a')).toBe(false);
  });
});
