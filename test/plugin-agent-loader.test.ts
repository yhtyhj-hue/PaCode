/**
 * Plugin agent loader tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPluginAgent, registerPluginAgents } from '../src/plugins/agent-loader.js';
import { SubagentManager } from '../src/agent/subagent.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('loadPluginAgent', () => {
  let pluginDir: string;

  beforeEach(() => {
    pluginDir = join(tmpdir(), `pacode-agent-${Date.now()}`);
    mkdirSync(join(pluginDir, 'agents'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(pluginDir)) rmSync(pluginDir, { recursive: true, force: true });
  });

  it('loads agent config from JSON', () => {
    writeFileSync(
      join(pluginDir, 'agents', 'lint.json'),
      JSON.stringify({
        name: 'lint',
        description: 'Lint agent',
        mode: 'acceptEdits',
        tools: ['Read', 'Grep'],
        systemPrompt: 'Find lint issues',
      })
    );

    const agent = loadPluginAgent(pluginDir, 'lint');
    expect(agent?.name).toBe('lint');
    expect(agent?.mode).toBe(PermissionMode.ACCEPT_EDITS);
    expect(agent?.tools).toEqual(['Read', 'Grep']);
  });

  it('returns null for missing file', () => {
    expect(loadPluginAgent(pluginDir, 'missing')).toBeNull();
  });
});

describe('registerPluginAgents', () => {
  it('registers multiple agents into manager', () => {
    const pluginDir = join(tmpdir(), `pacode-reg-${Date.now()}`);
    mkdirSync(join(pluginDir, 'agents'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'agents', 'a.json'),
      JSON.stringify({ name: 'a', description: 'Agent A' })
    );

    const manager = new SubagentManager();
    const count = registerPluginAgents(manager, pluginDir, ['a']);
    expect(count).toBe(1);
    expect(manager.get('a')).toBeDefined();

    rmSync(pluginDir, { recursive: true, force: true });
  });
});
