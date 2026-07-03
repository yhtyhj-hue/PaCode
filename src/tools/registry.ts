/**
 * Tool Registry
 */

import { ToolDefinition, ToolCall, ToolContext, ToolResult } from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private log: Logger;

  constructor() {
    this.log = new Logger({ prefix: 'ToolRegistry' });
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    this.log.debug(`Registered: ${tool.name}`);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.get(call.name);
    if (!tool) {
      return { content: [{ type: 'text', text: `Tool not found: ${call.name}` }], isError: true };
    }
    try {
      return await tool.execute(call.input, ctx);
    } catch (e) {
      return {
        content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
        isError: true,
      };
    }
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  clear(): void {
    this.tools.clear();
  }
}

let instance: ToolRegistry | null = null;
export function getToolRegistry(): ToolRegistry {
  if (!instance) instance = new ToolRegistry();
  return instance;
}
