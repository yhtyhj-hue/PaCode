/**
 * Plugin bootstrap — load manifests, commands, hooks
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '../pkg/logger/index.js';
import { HookRegistry } from '../hooks/registry.js';
import { PluginManager, Plugin } from './manager.js';
import { parseHooksFile, HooksFile } from '../hooks/loader.js';
import { SubagentManager } from '../agent/subagent.js';
import { registerPluginAgents } from './agent-loader.js';
import { registerPluginTools } from './tool-loader.js';
import { ToolRegistry } from '../tools/registry.js';

export interface PluginBootstrapOptions {
  pluginsDir?: string;
  subagentManager?: SubagentManager;
  toolRegistry?: ToolRegistry;
}

export interface PluginCommand {
  name: string;
  description: string;
  prompt: string;
  pluginName: string;
}

export interface PluginBootstrapResult {
  plugins: Plugin[];
  commands: PluginCommand[];
  hookCount: number;
  agentCount: number;
  toolCount: number;
}

/** 从插件目录加载 slash command markdown */
export function loadPluginCommand(pluginDir: string, commandName: string): PluginCommand | null {
  const cmdPath = join(pluginDir, 'commands', `${commandName}.md`);
  if (!existsSync(cmdPath)) return null;

  try {
    const raw = readFileSync(cmdPath, 'utf-8');
    const lines = raw.split('\n');
    let description = `Plugin command: ${commandName}`;
    let bodyStart = 0;

    if (lines[0]?.trim() === '---') {
      const endIdx = lines.indexOf('---', 1);
      if (endIdx > 0) {
        for (let i = 1; i < endIdx; i++) {
          const line = lines[i]!;
          const match = line.match(/^description:\s*(.+)$/i);
          if (match) description = match[1]!.trim();
        }
        bodyStart = endIdx + 1;
      }
    }

    const prompt = lines.slice(bodyStart).join('\n').trim();
    return {
      name: commandName,
      description,
      prompt: prompt || raw,
      pluginName: pluginDir.split('/').pop() ?? commandName,
    };
  } catch {
    return null;
  }
}

export async function bootstrapPlugins(
  hookRegistry: HookRegistry,
  options: PluginBootstrapOptions = {}
): Promise<PluginBootstrapResult> {
  const log = new Logger({ prefix: 'PluginBootstrap' });
  const manager = new PluginManager(options.pluginsDir);
  await manager.loadAll();

  const commands: PluginCommand[] = [];
  let hookCount = 0;
  let agentCount = 0;
  let toolCount = 0;

  for (const plugin of manager.list()) {
    const pluginDir = plugin.path;
    if (!pluginDir) continue;

    for (const cmdName of plugin.commands ?? []) {
      const cmd = loadPluginCommand(pluginDir, cmdName);
      if (cmd) {
        cmd.pluginName = plugin.name;
        commands.push(cmd);
      } else {
        log.warn(`Plugin ${plugin.name}: command file missing for ${cmdName}`);
      }
    }

    if (plugin.agents && options.subagentManager) {
      agentCount += registerPluginAgents(options.subagentManager, pluginDir, plugin.agents);
    }

    if (plugin.tools && options.toolRegistry) {
      toolCount += registerPluginTools(
        options.toolRegistry,
        pluginDir,
        plugin.name,
        plugin.tools
      );
    }

    if (plugin.hooks) {
      const hooks = parseHooksFile({ hooks: plugin.hooks as HooksFile['hooks'] });
      for (const hook of hooks) {
        hookRegistry.register(hook);
        hookCount++;
      }
    }
  }

  if (manager.list().length > 0) {
    log.info(
      `Loaded ${manager.list().length} plugin(s), ${commands.length} command(s), ${hookCount} hook(s), ${agentCount} agent(s), ${toolCount} tool(s)`
    );
  }

  return { plugins: manager.list(), commands, hookCount, agentCount, toolCount };
}
