/**
 * Edit Tool — Claude Code 对齐：默认要求 oldText 唯一；replaceAll 才批量替换
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';
import { resolvePathInWorkspace } from './path-utils.js';

/** 非重叠出现次数（与 String.replaceAll 语义一致） */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

export function registerEditTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'Edit',
    description:
      'Edit a file by replacing oldText with newText. oldText must match exactly once unless replaceAll is true.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldText: { type: 'string' },
        newText: { type: 'string' },
        replaceAll: {
          type: 'boolean',
          description: 'If true, replace every occurrence of oldText',
        },
      },
      required: ['path', 'oldText', 'newText'],
    },
    concurrencySafe: false,
    // DEFAULT：会话可确认后编辑；ACCEPT_EDITS 模式由 PermissionSystem 免确认
    permissionMode: PermissionMode.DEFAULT,
    async execute(input, ctx?: ToolContext) {
      const { path, oldText, newText, replaceAll } = input as {
        path: string;
        oldText: string;
        newText: string;
        replaceAll?: boolean;
      };
      const root = ctx?.workingDirectory ?? process.cwd();
      const resolved = resolvePathInWorkspace(path, root);
      if (!resolved.ok) {
        return { content: [{ type: 'text', text: resolved.reason }], isError: true };
      }
      if (oldText.length === 0) {
        return { content: [{ type: 'text', text: 'oldText must be non-empty' }], isError: true };
      }
      try {
        const content = readFileSync(resolved.resolved, 'utf-8');
        const occurrences = countOccurrences(content, oldText);
        if (occurrences === 0) {
          return { content: [{ type: 'text', text: 'Text not found' }], isError: true };
        }
        if (occurrences > 1 && !replaceAll) {
          return {
            content: [
              {
                type: 'text',
                text: `Found ${occurrences} occurrences of oldText; provide a more unique string or set replaceAll=true`,
              },
            ],
            isError: true,
          };
        }
        const next = replaceAll
          ? content.split(oldText).join(newText)
          : content.replace(oldText, newText);
        writeFileSync(resolved.resolved, next, 'utf-8');
        const n = replaceAll ? occurrences : 1;
        return {
          content: [{ type: 'text', text: `Edited ${path} (${n} replacement${n === 1 ? '' : 's'})` }],
        };
      } catch (e) {
        return { content: [{ type: 'text', text: String(e) }], isError: true };
      }
    },
  });
}
