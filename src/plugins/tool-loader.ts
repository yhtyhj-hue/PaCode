/**
 * Plugin tool loader — register tools from plugin manifests into ToolRegistry
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PermissionMode, ToolDefinition, ToolContext, ToolResult } from '../pkg/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { Logger } from '../pkg/logger/index.js';

const log = new Logger({ prefix: 'PluginToolLoader' });
const PLUGIN_TOOL_PREFIX = 'plugin__';

const VALID_MODES = new Set<string>(Object.values(PermissionMode));

export interface PluginToolHandlerEcho {
  type: 'echo';
  /** 静态文本；缺省时返回 JSON 化的 input */
  message?: string;
}

export interface PluginToolHandlerTemplate {
  type: 'template';
  template: string;
}

export type PluginToolHandler = PluginToolHandlerEcho | PluginToolHandlerTemplate;

export interface PluginToolManifest {
  name: string;
  description: string;
  inputSchema?: unknown;
  concurrencySafe?: boolean;
  permissionMode?: string;
  handler: PluginToolHandler;
}

/** 插件工具在 Registry 中的唯一名称，避免与核心/MCP 工具冲突 */
export function pluginToolName(pluginName: string, toolName: string): string {
  return `${PLUGIN_TOOL_PREFIX}${pluginName}__${toolName}`;
}

export function isPluginToolName(name: string): boolean {
  return name.startsWith(PLUGIN_TOOL_PREFIX);
}

function resolvePermissionMode(raw?: string): PermissionMode {
  if (raw && VALID_MODES.has(raw)) return raw as PermissionMode;
  return PermissionMode.DEFAULT;
}

function applyTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = input[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function runHandler(handler: PluginToolHandler, input: Record<string, unknown>): ToolResult {
  switch (handler.type) {
    case 'echo':
      return {
        content: [
          {
            type: 'text',
            text: handler.message ?? JSON.stringify(input),
          },
        ],
      };
    case 'template':
      return {
        content: [{ type: 'text', text: applyTemplate(handler.template, input) }],
      };
    default:
      return {
        content: [{ type: 'text', text: `Unsupported plugin tool handler` }],
        isError: true,
      };
  }
}

/** 从 plugins/{plugin}/tools/{name}.json 加载工具定义 */
export function loadPluginTool(
  pluginDir: string,
  toolName: string,
  pluginName: string
): ToolDefinition | null {
  const toolPath = join(pluginDir, 'tools', `${toolName}.json`);
  if (!existsSync(toolPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(toolPath, 'utf-8')) as PluginToolManifest;
    if (!raw.name || !raw.description || !raw.handler?.type) {
      log.warn(`Tool ${toolName} missing name, description, or handler`);
      return null;
    }

    const registryName = pluginToolName(pluginName, raw.name);

    return {
      name: registryName,
      description: raw.description,
      inputSchema: raw.inputSchema ?? { type: 'object', properties: {} },
      concurrencySafe: raw.concurrencySafe ?? true,
      permissionMode: resolvePermissionMode(raw.permissionMode),
      async execute(input: unknown, _ctx: ToolContext): Promise<ToolResult> {
        const record =
          input && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : {};
        return runHandler(raw.handler, record);
      },
    };
  } catch (e) {
    log.warn(
      `Failed to load tool ${toolName}: ${e instanceof Error ? e.message : String(e)}`
    );
    return null;
  }
}

/** 从 Registry 移除指定插件的工具 */
export function unregisterPluginTools(registry: ToolRegistry, pluginName: string): number {
  const prefix = `${PLUGIN_TOOL_PREFIX}${pluginName}__`;
  let removed = 0;
  for (const tool of registry.list()) {
    if (tool.name.startsWith(prefix)) {
      registry.unregister(tool.name);
      removed++;
    }
  }
  return removed;
}

/** 将插件 tools 注册到 ToolRegistry */
export function registerPluginTools(
  registry: ToolRegistry,
  pluginDir: string,
  pluginName: string,
  toolNames: string[]
): number {
  unregisterPluginTools(registry, pluginName);

  let count = 0;
  for (const toolName of toolNames) {
    const tool = loadPluginTool(pluginDir, toolName, pluginName);
    if (!tool) {
      log.warn(`Plugin ${pluginName}: tool file missing for ${toolName}`);
      continue;
    }
    registry.register(tool);
    count++;
  }
  return count;
}
