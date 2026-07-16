/**
 * Core tool registration — single entry for CLI, REPL, and subagents
 */

import { ToolRegistry } from './registry.js';
import { registerBashTool } from './bash.js';
import { registerReadTool } from './read.js';
import { registerWriteTool } from './write.js';
import { registerEditTool } from './edit.js';
import { registerGlobTool } from './glob.js';
import { registerGrepTool } from './grep.js';
import { registerTaskTool, TaskToolDeps } from './task.js';
import { registerTaskControlTools } from './task-control.js';
import { registerTeamTools } from './team.js';
import { registerTodoWriteTool } from './todowrite.js';
import { registerWebFetchTool } from '../services/web-fetch/index.js';
import { registerWebSearchTool } from '../services/web-search/index.js';
import { registerMcpRemoteTools } from '../services/mcp-sse-http/index.js';
import { registerMcpAuthTool } from '../services/mcp-auth/index.js';
import { registerAskUserTool } from '../services/ask-user/index.js';
import { registerPlanModeTools } from './plan-mode.js';

export interface CoreToolsOptions {
  /** Task 子代理依赖（含共享 ToolRegistry） */
  task?: TaskToolDeps;
}

/** 注册核心工具到同一 Registry */
export function registerCoreTools(registry: ToolRegistry, options: CoreToolsOptions = {}): void {
  registerBashTool(registry);
  registerReadTool(registry);
  registerWriteTool(registry);
  registerEditTool(registry);
  registerGlobTool(registry);
  registerGrepTool(registry);
  if (options.task) {
    registerTaskTool(registry, options.task);
  } else {
    registerTaskTool(registry, { toolRegistry: registry });
  }
  registerTaskControlTools(registry);
  registerTeamTools(registry);
  registerTodoWriteTool(registry);
  registerWebFetchTool(registry);
  registerWebSearchTool(registry);
  registerMcpRemoteTools(registry);
  registerMcpAuthTool(registry);
  registerAskUserTool(registry);
  registerPlanModeTools(registry);
}

/** 从父 Registry 复制指定工具（子代理工具白名单） */
export function createFilteredRegistry(
  source: ToolRegistry,
  allowedNames: string[]
): ToolRegistry {
  const filtered = new ToolRegistry();
  for (const name of allowedNames) {
    const tool = source.get(name);
    if (tool) filtered.register(tool);
  }
  return filtered;
}
