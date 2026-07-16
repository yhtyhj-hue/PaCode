/**
 * Read Tool — file contents with offset/limit/range support (H4 tool fidelity)
 */

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';
import { resolvePathInWorkspace } from './path-utils.js';

const DEFAULT_LINE_LIMIT = 2000;
const LARGE_FILE_BYTES = 200 * 1024; // 200KB

export function registerReadTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'Read',
    description:
      'Read file contents. Supports offset (1-based line) and limit to read parts of large files. Errors with friendly messages for missing / oversized / permission-denied.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'number', minimum: 1, description: '1-based start line; default 1' },
        limit: {
          type: 'number',
          description: 'Max lines to read; default 2000',
        },
      },
      required: ['path'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input, ctx?: ToolContext) {
      const { path, offset, limit } = input as {
        path: string;
        offset?: number;
        limit?: number;
      };
      const root = ctx?.workingDirectory ?? process.cwd();
      const resolved = resolvePathInWorkspace(path, root);
      if (!resolved.ok) {
        return { content: [{ type: 'text', text: resolved.reason }], isError: true };
      }
      const absPath = resolve(resolved.resolved);
      try {
        const stat = statSync(absPath);
        if (stat.isDirectory()) {
          return {
            content: [
              {
                type: 'text',
                text: `Path is a directory, not a file. ${absPath}`,
              },
            ],
            isError: true,
          };
        }
        if (stat.size > LARGE_FILE_BYTES) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `File is ${(stat.size / 1024).toFixed(1)}KB (large). ` +
                  `Use offset/limit to read parts of it, e.g. Read(path="${path}", offset=1, limit=200).`,
              },
            ],
            isError: true,
          };
        }
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') {
          return {
            content: [
              { type: 'text', text: `File not found: ${path} (resolved: ${absPath})` },
            ],
            isError: true,
          };
        }
        if (code === 'EACCES' || code === 'EPERM') {
          return {
            content: [
              { type: 'text', text: `Permission denied reading ${path}` },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: `stat failed: ${String(e)}` }],
          isError: true,
        };
      }
      try {
        const allLines = readFileSync(absPath, 'utf-8').split('\n');
        const startLine = Math.max(1, Math.floor(offset ?? 1));
        const maxLines = Math.max(1, Math.floor(limit ?? DEFAULT_LINE_LIMIT));
        const startIdx = startLine - 1;
        const slice = allLines.slice(startIdx, startIdx + maxLines);
        const isPartial = startIdx > 0 || slice.length < allLines.length;
        let content = slice.join('\n');
        if (isPartial) {
          const endLine = startIdx + slice.length;
          const totalLines = allLines.length;
          content =
            `[note: showing lines ${startLine}-${endLine} of ${totalLines} total; use offset to read more]\n\n` +
            content;
        }
        return { content: [{ type: 'text', text: content }] };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `read failed: ${String(e)}` }],
          isError: true,
        };
      }
    },
  });
}
