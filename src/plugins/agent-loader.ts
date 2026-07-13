/**
 * Plugin agent loader — register subagents from plugin manifests
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PermissionMode } from '../pkg/types.js';
import { SubagentConfig, SubagentManager } from '../agent/subagent.js';
import { Logger } from '../pkg/logger/index.js';

const log = new Logger({ prefix: 'PluginAgentLoader' });

const VALID_MODES = new Set<string>(Object.values(PermissionMode));

export interface PluginAgentManifest {
  name: string;
  description: string;
  model?: string;
  mode?: string;
  systemPrompt?: string;
  tools?: string[];
}

/** 从 plugins/{plugin}/agents/{name}.json 加载 agent 配置 */
export function loadPluginAgent(pluginDir: string, agentName: string): SubagentConfig | null {
  const agentPath = join(pluginDir, 'agents', `${agentName}.json`);
  if (!existsSync(agentPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(agentPath, 'utf-8')) as PluginAgentManifest;
    if (!raw.name || !raw.description) {
      log.warn(`Agent ${agentName} missing name or description`);
      return null;
    }

    const mode =
      raw.mode && VALID_MODES.has(raw.mode) ? (raw.mode as PermissionMode) : PermissionMode.DEFAULT;

    return {
      name: raw.name,
      description: raw.description,
      model: raw.model,
      mode,
      systemPrompt: raw.systemPrompt,
      tools: raw.tools,
    };
  } catch (e) {
    log.warn(`Failed to load agent ${agentName}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** 将插件 agents 注册到 SubagentManager */
export function registerPluginAgents(
  manager: SubagentManager,
  pluginDir: string,
  agentNames: string[]
): number {
  let count = 0;
  for (const agentName of agentNames) {
    const config = loadPluginAgent(pluginDir, agentName);
    if (!config) {
      log.warn(`Plugin agent file missing: ${agentName}`);
      continue;
    }
    manager.register(config);
    count++;
  }
  return count;
}
