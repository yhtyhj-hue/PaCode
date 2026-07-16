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
import { registerCoordinatorTool } from './coordinator.js';
import { registerSkillTools } from './skill-tools.js';
import { registerConfigTool } from './config-tool.js';
import { registerNotebookEditTool } from './notebook-edit.js';
import { registerScheduleCronTool } from './schedule-cron.js';
import { registerLspTool } from './lsp.js';
import { registerTodoWriteTool } from './todowrite.js';
import { registerWebFetchTool } from '../services/web-fetch/index.js';
import { registerWebSearchTool } from '../services/web-search/index.js';
import { registerMcpRemoteTools } from '../services/mcp-sse-http/index.js';
import { registerMcpAuthTool } from '../services/mcp-auth/index.js';
import { registerAskUserTool } from '../services/ask-user/index.js';
import { registerPlanModeTools } from './plan-mode.js';
import type { SkillsLoader } from '../skills/loader.js';

export interface CoreToolsOptions {
  /** Task 子代理依赖（含共享 ToolRegistry） */
  task?: TaskToolDeps;
  /** K1: 共享 SkillsLoader（SkillTool / 延迟索引） */
  skillsLoader?: SkillsLoader;
}

/** 注册核心工具到同一 Registry */
export function registerCoreTools(registry: ToolRegistry, options: CoreToolsOptions = {}): void {
  registerBashTool(registry);
  registerReadTool(registry);
  registerWriteTool(registry);
  registerEditTool(registry);
  registerNotebookEditTool(registry);
  registerGlobTool(registry);
  registerGrepTool(registry);
  const taskDeps = options.task ?? { toolRegistry: registry };
  registerTaskTool(registry, taskDeps);
  registerTaskControlTools(registry);
  registerTeamTools(registry);
  registerCoordinatorTool(registry, {
    toolRegistry: taskDeps.toolRegistry,
    apiKey: taskDeps.apiKey,
    baseUrl: taskDeps.baseUrl,
    model: taskDeps.model,
  });
  registerTodoWriteTool(registry);
  registerWebFetchTool(registry);
  registerWebSearchTool(registry);
  registerMcpRemoteTools(registry);
  registerMcpAuthTool(registry);
  registerAskUserTool(registry);
  registerPlanModeTools(registry);
  registerConfigTool(registry);
  registerScheduleCronTool(registry);
  registerLspTool(registry);
  // K1: 最后注册，ToolSearch 执行时可见全部工具
  registerSkillTools(registry, {
    toolRegistry: registry,
    skillsLoader: options.skillsLoader,
  });
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
