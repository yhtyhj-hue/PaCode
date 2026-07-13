/**
 * Tool setup — core tools + MCP bootstrap (shared by CLI and REPL)
 */

import { ToolRegistry, getToolRegistry } from './registry.js';
import { registerCoreTools } from './bootstrap.js';
import { TaskToolDeps } from './task.js';
import { bootstrapMcpTools, McpBootstrapResult } from '../mcp/loader.js';
import { HookRegistry } from '../hooks/registry.js';
import { bootstrapHooks } from '../hooks/loader.js';
import { bootstrapPlugins } from '../plugins/bootstrap.js';
import { SubagentManager } from '../agent/subagent.js';

export interface ToolSetupOptions {
  registry?: ToolRegistry;
  hookRegistry?: HookRegistry;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  connectMcp?: boolean;
  mcpConfigPath?: string;
  loadHooks?: boolean;
  bootstrapPlugins?: boolean;
  pluginsDir?: string;
  subagentManager?: SubagentManager;
}

export interface ToolSetupResult {
  registry: ToolRegistry;
  hookRegistry: HookRegistry;
  mcp: McpBootstrapResult | null;
}

/** 注册核心工具、hooks、MCP，返回共享 Registry */
export async function setupToolRegistry(options: ToolSetupOptions = {}): Promise<ToolSetupResult> {
  const registry = options.registry ?? getToolRegistry();
  const hookRegistry = options.hookRegistry ?? new HookRegistry();

  const taskDeps: TaskToolDeps = {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
    toolRegistry: registry,
  };

  registerCoreTools(registry, { task: taskDeps });

  if (options.loadHooks !== false) {
    bootstrapHooks(hookRegistry);
  }

  let mcp: McpBootstrapResult | null = null;
  if (options.connectMcp !== false) {
    mcp = await bootstrapMcpTools(registry, { configPath: options.mcpConfigPath });
  }

  if (options.bootstrapPlugins) {
    await bootstrapPlugins(hookRegistry, {
      pluginsDir: options.pluginsDir,
      toolRegistry: registry,
      subagentManager: options.subagentManager,
    });
  }

  return { registry, hookRegistry, mcp };
}
