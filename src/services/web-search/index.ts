/** Public WebSearch tool registration. */

import { PermissionMode, type ToolDefinition, type ToolResult } from '../../pkg/types.js';
import { ToolRegistry } from '../../tools/registry.js';
import { search } from './search.js';
import { WebSearchError, type WebSearchInput } from './types.js';

const WEB_SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Search query. Current information should be searched instead of guessed.' },
    region: { type: 'string', description: 'Optional Brave country/region code, such as US or GB.' },
    recency_days: { type: 'integer', enum: [1, 7, 30, 365], description: 'Limit results to the last 1, 7, 30, or 365 days.' },
  },
  required: ['query'],
  additionalProperties: false,
} as const;

function errorResult(error: unknown): ToolResult {
  if (error instanceof WebSearchError) {
    const suffix = error.status === undefined ? '' : ` (HTTP ${error.status})`;
    return {
      content: [{ type: 'text', text: `WebSearch error [${error.category}]${suffix}: ${error.message}` }],
      isError: true,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: `WebSearch error [network]: ${message}` }],
    isError: true,
  };
}

export function registerWebSearchTool(registry: ToolRegistry): void {
  const tool: ToolDefinition = {
    name: 'WebSearch',
    description: 'Search the web for current information. Call this when an answer depends on recent events, prices, documentation, or other information not present in the conversation.',
    inputSchema: WEB_SEARCH_SCHEMA,
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input: unknown): Promise<ToolResult> {
      try {
        const response = await search(input as WebSearchInput);
        const text = response.formatted || `No search results for: ${response.query}`;
        return { content: [{ type: 'text', text }] };
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  };
  registry.register(tool);
}

export * from './result-format.js';
export * from './search.js';
export * from './types.js';
