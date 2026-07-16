/**
 * Grep Tool — ripgrep-backed with proper flags (H4 tool fidelity)
 */

import { execFile } from 'node:child_process';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';

export function registerGrepTool(registry: { register: (t: ToolDefinition) => void }) {
  registry.register({
    name: 'Grep',
    description:
      'Search for pattern in files using ripgrep. Supports ignore_case, include/exclude globs, line numbers, context lines, and files_with_matches output mode.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        ignore_case: { type: 'boolean' },
        include: { type: 'string' },
        exclude: { type: 'string' },
        context_before: { type: 'number' },
        context_after: { type: 'number' },
        context: { type: 'number' },
        output_mode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count'],
        },
        max_results: { type: 'number' },
      },
      required: ['pattern'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input, ctx?: ToolContext) {
      const {
        pattern,
        path = '.',
        ignore_case,
        include,
        exclude,
        context_before,
        context_after,
        context,
        output_mode = 'content',
        max_results = 200,
      } = input as {
        pattern: string;
        path?: string;
        ignore_case?: boolean;
        include?: string;
        exclude?: string;
        context_before?: number;
        context_after?: number;
        context?: number;
        output_mode?: 'content' | 'files_with_matches' | 'count';
        max_results?: number;
      };

      const root = ctx?.workingDirectory ?? process.cwd();
      const searchPath = isAbsolute(path) ? path : resolvePath(root, path);

      // Build ripgrep argv (flags first, then path, then -- pattern)
      const args: string[] = [];
      if (ignore_case) args.push('-i');
      if (include) args.push('--glob', include);
      if (exclude) args.push('--glob', '!' + exclude);
      if (typeof context === 'number') {
        args.push('-C', String(context));
      } else {
        if (typeof context_before === 'number') args.push('-B', String(context_before));
        if (typeof context_after === 'number') args.push('-A', String(context_after));
      }
      if (output_mode === 'files_with_matches') args.push('-l');
      if (output_mode === 'count') args.push('-c');
      args.push('--', pattern, searchPath);

      return new Promise((resolve) => {
        execFile(
          'rg',
          args,
          { timeout: 30000, maxBuffer: 10 * 1024 * 1024, cwd: root },
          (err, stdout, stderr) => {
          if (err && !stdout) {
            resolve({ content: [{ type: 'text', text: stderr || 'No matches' }] });
            return;
          }
          // Apply max_results cap (rg has no native limit flag we pass)
          const lines = stdout.split('\n');
          let text: string;
          let truncated = false;
          if (lines.length > max_results) {
            text =
              lines.slice(0, max_results).join('\n') +
              `\n\n… [truncated ${lines.length - max_results} of ${lines.length} total lines; raise max_results or refine pattern to see more]`;
            truncated = true;
          } else {
            text = stdout;
          }
          if (truncated || err?.message?.includes('timed out')) {
            text = `[note: output may be truncated; consider narrower path or higher max_results]\n\n${text}`;
          }
          resolve({ content: [{ type: 'text', text }] });
        });
      });
    },
  });
}
