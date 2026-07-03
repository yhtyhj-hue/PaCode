/**
 * Subagent System
 *
 * Allows spawning isolated subagents for parallel or focused tasks.
 * Mirrors Claude Code's Task tool / subagent delegation.
 */

import { QueryEngine } from './engine.js';
import { PermissionMode } from '../pkg/types.js';

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

  async run(config: SubagentConfig, prompt: string): Promise<SubagentResult> {
    const startTime = Date.now();
    let toolCalls = 0;
    let output = '';

    try {
      const engine = new QueryEngine({});
      const session = {
        sessionId: `sub-${Date.now()}`,
        messages: [],
        toolCallHistory: [],
        maxOutputTokensRecoveryCount: 0,
        mode: config.mode ?? PermissionMode.DEFAULT,
        hooks: { hooks: {} },
        compactionHistory: [],
      };

      for await (const event of engine.query(
        { message: prompt, options: { systemPrompt: config.systemPrompt } },
        session
      )) {
        if (event.type === 'content_block_delta' && event.delta) {
          output += event.delta.text;
        } else if (event.type === 'tool_use') {
          toolCalls++;
        } else if (event.type === 'error') {
          return {
            name: config.name,
            success: false,
            output: output + `\n[Error: ${event.error?.message ?? 'Unknown'}]`,
            toolCalls,
            duration: Date.now() - startTime,
            error: event.error?.message,
          };
        }
      }

      return {
        name: config.name,
        success: true,
        output,
        toolCalls,
        duration: Date.now() - startTime,
      };
    } catch (e) {
      return {
        name: config.name,
        success: false,
        output: e instanceof Error ? e.message : String(e),
        toolCalls,
        duration: Date.now() - startTime,
        error: e instanceof Error ? e.message : String(e),
      };
    }
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
