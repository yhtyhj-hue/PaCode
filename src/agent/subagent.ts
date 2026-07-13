/**
 * Subagent System
 *
 * Allows spawning isolated subagents for parallel or focused tasks.
 * Mirrors Claude Code's Task tool / subagent delegation.
 */

import { QueryEngine, QueryEngineOptions } from './engine.js';
import { PermissionMode, HookType, ToolContext } from '../pkg/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { createFilteredRegistry, registerCoreTools } from '../tools/bootstrap.js';
import { HookRegistry } from '../hooks/registry.js';

export interface SubagentConfig {
  name: string;
  description: string;
  model?: string;
  mode?: PermissionMode;
  systemPrompt?: string;
  tools?: string[];
}

export interface SubagentResult {
  name: string;
  success: boolean;
  output: string;
  toolCalls: number;
  duration: number;
  error?: string;
}

export interface SubagentRunOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  toolRegistry?: ToolRegistry;
  hookRegistry?: HookRegistry;
  /** 测试注入：自定义 QueryEngine 构造 */
  createEngine?: (options: QueryEngineOptions) => QueryEngine;
}

export class SubagentManager {
  private agents = new Map<string, SubagentConfig>();

  register(config: SubagentConfig): void {
    this.agents.set(config.name, config);
  }

  get(name: string): SubagentConfig | undefined {
    return this.agents.get(name);
  }

  list(): SubagentConfig[] {
    return Array.from(this.agents.values());
  }

  registerDefaults(): void {
    this.register({
      name: 'general-purpose',
      description: 'General-purpose agent for researching and executing complex tasks',
      mode: PermissionMode.DEFAULT,
    });

    this.register({
      name: 'explore',
      description: 'Read-only agent for exploring codebases',
      mode: PermissionMode.ACCEPT_EDITS,
      tools: ['Read', 'Glob', 'Grep'],
    });

    this.register({
      name: 'plan',
      description: 'Planning agent - generates implementation plans without executing',
      mode: PermissionMode.PLAN,
    });
  }

  async run(
    config: SubagentConfig,
    prompt: string,
    options: SubagentRunOptions = {}
  ): Promise<SubagentResult> {
    const startTime = Date.now();
    let toolCalls = 0;
    let output = '';
    let result: SubagentResult;

    try {
      const parentRegistry = options.toolRegistry ?? new ToolRegistry();
      const registry =
        config.tools && config.tools.length > 0
          ? createFilteredRegistry(parentRegistry, config.tools)
          : parentRegistry;

      if (registry.list().length === 0) {
        registerCoreTools(registry, {
          task: {
            apiKey: options.apiKey,
            baseUrl: options.baseUrl,
            model: options.model,
            toolRegistry: registry,
          },
        });
      }

      const engine =
        options.createEngine?.({
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          toolRegistry: registry,
          hookRegistry: options.hookRegistry,
        }) ??
        new QueryEngine({
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          toolRegistry: registry,
          hookRegistry: options.hookRegistry,
        });

      const session = {
        sessionId: `sub-${Date.now()}`,
        messages: [] as Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }>,
        toolCallHistory: [],
        maxOutputTokensRecoveryCount: 0,
        mode: config.mode ?? PermissionMode.DEFAULT,
        hooks: { hooks: {} },
        compactionHistory: [],
      };

      session.messages.push({ role: 'user', content: prompt, timestamp: Date.now() });

      for await (const event of engine.query(
        {
          options: {
            model: options.model ?? config.model,
            systemPrompt: config.systemPrompt,
          },
        },
        session
      )) {
        if (event.type === 'content_block_delta' && event.delta) {
          output += event.delta.text;
        } else if (event.type === 'tool_use') {
          toolCalls++;
        } else if (event.type === 'error') {
          result = {
            name: config.name,
            success: false,
            output: output + `\n[Error: ${event.error?.message ?? 'Unknown'}]`,
            toolCalls,
            duration: Date.now() - startTime,
            error: event.error?.message,
          };
          await runSubagentStopHooks(options.hookRegistry, config, result);
          return result;
        }
      }

      result = {
        name: config.name,
        success: true,
        output,
        toolCalls,
        duration: Date.now() - startTime,
      };
    } catch (e) {
      result = {
        name: config.name,
        success: false,
        output: e instanceof Error ? e.message : String(e),
        toolCalls,
        duration: Date.now() - startTime,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    await runSubagentStopHooks(options.hookRegistry, config, result);
    return result;
  }
}

/** SubagentStop hook — 子代理结束时触发 */
async function runSubagentStopHooks(
  registry: HookRegistry | undefined,
  config: SubagentConfig,
  _result: SubagentResult
): Promise<void> {
  if (!registry) return;

  const ctx: ToolContext = {
    workingDirectory: process.cwd(),
    sessionState: {
      sessionId: `subagent-${config.name}`,
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: config.mode ?? PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    },
    hooks: registry,
  };

  const matching = registry.findMatching(HookType.SUBAGENT_STOP, ctx);
  for (const hook of matching) {
    await registry.execute(hook);
  }
}

let instance: SubagentManager | null = null;
export function getSubagentManager(): SubagentManager {
  if (!instance) {
    instance = new SubagentManager();
    instance.registerDefaults();
  }
  return instance;
}

export function resetSubagentManager(): void {
  instance = null;
}
