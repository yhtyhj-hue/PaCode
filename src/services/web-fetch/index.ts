/**
 * WebFetch service public API.
 *
 * Registers a `WebFetch` tool into a PaCode `ToolRegistry`. The tool
 * fetches a URL, extracts plain text from HTML, and strips prompt-
 * injection carriers before returning the result to the agent.
 *
 * Usage from `src/tools/bootstrap.ts` (Stage 2):
 *
 *   import { registerWebFetchTool } from '../../services/web-fetch/index.js';
 *   registerWebFetchTool(registry);
 */

import { PermissionMode, ToolDefinition } from '../../pkg/types.js';
import { webFetch, WebFetchException, summarizeWarnings } from './fetch.js';
import type { WebFetchInput } from './types.js';

export type {
  WebFetchInput,
  WebFetchOptions,
  WebFetchOutput,
  WebFetchError,
  WebFetchErrorKind,
  SanitizationWarning,
} from './types.js';

export { webFetch, WebFetchException, summarizeWarnings } from './fetch.js';
export { htmlToText } from './extract.js';
export { sanitizePromptInjection, maskBase64Blob } from './prompt-injection.js';

export interface ToolRegistryLike {
  register(tool: ToolDefinition): void;
}

/**
 * Standard PaCode registration entry point. Safe to call once at
 * bootstrap; calling twice with the same registry is a no-op for the
 * underlying Map (the second register overwrites).
 */
export function registerWebFetchTool(registry: ToolRegistryLike): void {
  const tool: ToolDefinition = {
    name: 'WebFetch',
    description:
      'Fetch the contents of a URL and return its plain-text body. ' +
      'HTML pages are converted to text and sanitized to remove prompt-injection ' +
      'carriers (HTML comments, CSS-hidden text, base64 blobs, common override ' +
      'patterns). HTTP/HTTPS only. 10s default timeout, 5 MiB size cap.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch. Must be http(s).',
        },
        prompt: {
          type: 'string',
          description: 'Optional natural-language hint about what to extract from the page.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input: unknown) {
      try {
        const args = parseInput(input);
        const result = await webFetch(args.url, { prompt: args.prompt });
        const footer = summarizeWarnings(result.warnings);
        const header =
          `URL: ${result.finalUrl}\n` +
          `Status: ${result.status}\n` +
          `Content-Type: ${result.contentType || 'unknown'}\n` +
          `Bytes: ${result.bytes}\n` +
          (result.sanitized ? 'Sanitized: yes\n' : '');

        const body =
          (args.prompt ? `Prompt: ${args.prompt}\n\n` : '') +
          result.text +
          (footer ? `\n\n--- sanitization warnings ---\n${footer}` : '');

        return {
          content: [
            {
              type: 'text',
              text: `${header}\n${body}`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof WebFetchException) {
          return {
            content: [
              {
                type: 'text',
                text: `WebFetch failed (${err.kind}): ${err.message}`,
              },
            ],
            isError: true,
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `WebFetch failed: ${message}` }],
          isError: true,
        };
      }
    },
  };

  registry.register(tool);
}

function parseInput(input: unknown): WebFetchInput {
  if (input === null || typeof input !== 'object') {
    throw new Error('WebFetch input must be an object with a "url" string');
  }
  const record = input as Record<string, unknown>;
  const url = record.url;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('WebFetch input is missing required "url" string');
  }
  const promptRaw = record.prompt;
  const prompt = typeof promptRaw === 'string' && promptRaw.length > 0 ? promptRaw : undefined;
  return { url, prompt };
}