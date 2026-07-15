import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { PermissionMode } from '../../pkg/types.js';
import type { ToolDefinition, ToolResult } from '../../pkg/types.js';
import type { ToolRegistry } from '../../tools/registry.js';
import { ToolRegistry as RuntimeToolRegistry } from '../../tools/registry.js';
import { createHttpTransport } from './http-transport.js';
import { createSseTransport } from './sse-transport.js';
import type {
  McpHttpOptions,
  McpRemoteToolInput,
  McpRemoteToolOptions,
  McpSseOptions,
} from './types.js';

const CLIENT_INFO = Object.freeze({ name: 'pacode-mcp-remote', version: '0.1.0' });

const TOOL_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    url: { type: 'string', format: 'uri', description: 'Remote MCP server URL' },
    headers: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'HTTP headers sent to the remote MCP server',
    },
    options: {
      type: 'object',
      additionalProperties: false,
      properties: {
        timeoutMs: { type: 'number', minimum: 1 },
        maxAttempts: { type: 'number', minimum: 1 },
        baseDelayMs: { type: 'number', minimum: 0 },
        maxDelayMs: { type: 'number', minimum: 0 },
      },
    },
  },
  required: ['url'],
});

type TransportFactory = (
  url: string | URL,
  options: McpHttpOptions | McpSseOptions,
) => Promise<Transport>;

function createRemoteTool(
  name: string,
  description: string,
  factory: TransportFactory,
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: TOOL_INPUT_SCHEMA,
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = parseToolInput(input);
      let transport: Transport | undefined;
      let client: Client | undefined;
      try {
        transport = await factory(parsed.url, {
          headers: parsed.headers,
          ...parsed.options,
        });
        client = new Client(CLIENT_INFO, { capabilities: {} });
        await client.connect(transport);
        const ping = await client.ping({ timeout: parsed.options?.timeoutMs ?? 30_000 });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'PingResult',
                transport: name === 'McpSse' ? 'sse' : 'http',
                url: parsed.url,
                sessionId: transport.sessionId,
                result: ping,
              }),
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [{ type: 'text', text: formatError(name, parsed.url, error) }],
          isError: true,
        };
      } finally {
        try {
          if (client) {
            await client.close();
          } else if (transport) {
            await transport.close();
          }
        } catch {
          // Preserve the primary connection or ping error. Cleanup errors are
          // reported by the transport's onerror callback when available.
        }
      }
    },
  };
}

export const McpSseTool: ToolDefinition = createRemoteTool(
  'McpSse',
  'Connect to an MCP server over legacy HTTP+SSE and validate it with an MCP ping.',
  createSseTransport,
);

export const McpHttpTool: ToolDefinition = createRemoteTool(
  'McpHttp',
  'Connect to an MCP server over Streamable HTTP and validate it with an MCP ping.',
  createHttpTransport,
);

export function registerMcpRemoteTools(registry: ToolRegistry): void {
  registry.register(McpSseTool);
  registry.register(McpHttpTool);
}

export function createMcpRemoteToolRegistry(): ToolRegistry {
  const registry = new RuntimeToolRegistry();
  registerMcpRemoteTools(registry);
  return registry;
}

function parseToolInput(input: unknown): McpRemoteToolInput {
  if (!isRecord(input)) {
    throw new TypeError('MCP remote tool input must be an object');
  }
  if (typeof input.url !== 'string' || input.url.trim().length === 0) {
    throw new TypeError('MCP remote tool requires a non-empty url');
  }
  const url = new URL(input.url).href;
  const headers = parseHeaders(input.headers);
  const options = parseOptions(input.options);
  return { url, headers, options };
}

function parseHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new TypeError('MCP headers must be an object of string values');
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item !== 'string') {
        throw new TypeError(`MCP header ${key} must be a string`);
      }
      return [key, item];
    }),
  );
}

function parseOptions(value: unknown): McpRemoteToolOptions | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new TypeError('MCP options must be an object');
  }
  return {
    timeoutMs: optionalPositiveNumber(value.timeoutMs, 'timeoutMs'),
    maxAttempts: optionalPositiveInteger(value.maxAttempts, 'maxAttempts'),
    baseDelayMs: optionalNonNegativeNumber(value.baseDelayMs, 'baseDelayMs'),
    maxDelayMs: optionalNonNegativeNumber(value.maxDelayMs, 'maxDelayMs'),
  };
}

function optionalPositiveNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`MCP ${name} must be greater than zero`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  const result = optionalPositiveNumber(value, name);
  if (result !== undefined && !Number.isInteger(result)) {
    throw new RangeError(`MCP ${name} must be an integer`);
  }
  return result;
}

function optionalNonNegativeNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`MCP ${name} must be zero or greater`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatError(toolName: string, url: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${toolName} connection to ${url} failed: ${message}`;
}

export { createSseTransport } from './sse-transport.js';
export { createHttpTransport } from './http-transport.js';
export {
  calculateBackoffDelay,
  getHttpStatus,
  isRetryableError,
  isRetryableStatus,
  retryWithBackoff,
  RetryAbortError,
  RETRY_DEFAULTS,
} from './reconnect.js';
export type {
  McpHttpOptions,
  McpRemoteToolInput,
  McpRemoteToolOptions,
  McpRetryOptions,
  McpSseOptions,
  McpTransport,
  McpTransportOptions,
} from './types.js';
