/**
 * Plugin bootstrap tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrapPlugins, loadPluginCommand } from '../src/plugins/bootstrap.js';
import { HookRegistry } from '../src/hooks/registry.js';
import { SubagentManager } from '../src/agent/subagent.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { pluginToolName } from '../src/plugins/tool-loader.js';

describe('loadPluginCommand', () => {
  let pluginDir: string;

  beforeEach(() => {
    pluginDir = join(tmpdir(), `pacode-plugin-${Date.now()}`);
    mkdirSync(join(pluginDir, 'commands'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(pluginDir)) rmSync(pluginDir, { recursive: true, force: true });
  });

  it('parses frontmatter description', () => {
    writeFileSync(
      join(pluginDir, 'commands', 'demo.md'),
      '---\ndescription: Demo command\n---\n\nDo the demo thing.'
    );

    const cmd = loadPluginCommand(pluginDir, 'demo');
    expect(cmd?.description).toBe('Demo command');
    expect(cmd?.prompt).toContain('Do the demo thing');
  });
});

describe('bootstrapPlugins', () => {
  let pluginsRoot: string;
  let hooks: HookRegistry;

  beforeEach(() => {
    pluginsRoot = join(tmpdir(), `pacode-plugins-${Date.now()}`);
    hooks = new HookRegistry();
    const pluginDir = join(pluginsRoot, 'test-plugin');
    mkdirSync(join(pluginDir, 'commands'), { recursive: true });

    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        name: 'test-plugin',
        version: '0.1.0',
        description: 'Test plugin',
        commands: ['run'],
      })
    );

    writeFileSync(join(pluginDir, 'commands', 'run.md'), 'Run the test plugin workflow.');
  });

  afterEach(() => {
    if (existsSync(pluginsRoot)) rmSync(pluginsRoot, { recursive: true, force: true });
  });

  it('loads plugin commands from directory', async () => {
    const result = await bootstrapPlugins(hooks, { pluginsDir: pluginsRoot });
    expect(result.plugins).toHaveLength(1);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]?.name).toBe('run');
  });

  it('registers plugin agents when subagentManager provided', async () => {
    const pluginDir = join(pluginsRoot, 'agent-plugin');
    mkdirSync(join(pluginDir, 'agents'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        name: 'agent-plugin',
        version: '0.1.0',
        description: 'Agent plugin',
        agents: ['helper'],
      })
    );
    writeFileSync(
      join(pluginDir, 'agents', 'helper.json'),
      JSON.stringify({
        name: 'helper',
        description: 'Helper agent',
        mode: 'default',
        tools: ['Read'],
      })
    );

    const manager = new SubagentManager();
    const result = await bootstrapPlugins(hooks, {
      pluginsDir: pluginsRoot,
      subagentManager: manager,
    });

    expect(result.agentCount).toBeGreaterThanOrEqual(1);
    expect(manager.get('helper')).toBeDefined();
  });

  it('registers plugin tools when toolRegistry provided', async () => {
    const pluginDir = join(pluginsRoot, 'tool-plugin');
    mkdirSync(join(pluginDir, 'tools'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        name: 'tool-plugin',
        version: '0.1.0',
        description: 'Tool plugin',
        tools: ['echo'],
      })
    );
    writeFileSync(
      join(pluginDir, 'tools', 'echo.json'),
      JSON.stringify({
        name: 'echo',
        description: 'Echo tool',
        handler: { type: 'echo', message: 'plugin-echo' },
      })
    );

    const registry = new ToolRegistry();
    const result = await bootstrapPlugins(hooks, {
      pluginsDir: pluginsRoot,
      toolRegistry: registry,
    });

    expect(result.toolCount).toBeGreaterThanOrEqual(1);
    expect(registry.has(pluginToolName('tool-plugin', 'echo'))).toBe(true);
  });
});

describe('bootstrapPlugins — repo example', () => {
  it('loads bundled example plugin with agent and tool', async () => {
    const hooks = new HookRegistry();
    const manager = new SubagentManager();
    const registry = new ToolRegistry();
    const result = await bootstrapPlugins(hooks, {
      subagentManager: manager,
      toolRegistry: registry,
    });
    const example = result.plugins.find((p) => p.name === 'example');
    expect(example).toBeDefined();
    expect(result.commands.some((c) => c.name === 'hello')).toBe(true);
    expect(manager.get('reviewer')).toBeDefined();
    expect(result.agentCount).toBeGreaterThanOrEqual(1);
    expect(registry.has(pluginToolName('example', 'greet'))).toBe(true);
    expect(result.toolCount).toBeGreaterThanOrEqual(1);
  });
});
