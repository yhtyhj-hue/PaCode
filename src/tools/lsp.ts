/**
 * K4: LSP tool — 无 language server；封装 tsc/eslint 诊断
 */

import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';
import { collectDiagnostics } from '../services/diagnostics/index.js';
import { resolvePathInWorkspace } from './path-utils.js';

export function registerLspTool(registry: { register: (t: ToolDefinition) => void }): void {
  registry.register({
    name: 'LSP',
    description:
      'Collect project diagnostics without a language server (runs tsc --noEmit or eslint). Not a full LSP client.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['diagnostics'],
          description: 'diagnostics (default)',
        },
        prefer: {
          type: 'string',
          enum: ['tsc', 'eslint'],
          description: 'Prefer engine when both available',
        },
        path: {
          type: 'string',
          description: 'Optional workspace root (default cwd)',
        },
      },
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input, ctx?: ToolContext) {
      const {
        action = 'diagnostics',
        prefer,
        path,
      } = input as {
        action?: 'diagnostics';
        prefer?: 'tsc' | 'eslint';
        path?: string;
      };

      if (action !== 'diagnostics') {
        return {
          content: [{ type: 'text', text: `Unknown action: ${action}` }],
          isError: true,
        };
      }

      const root = ctx?.workingDirectory ?? process.cwd();
      let cwd = root;
      if (path) {
        const resolved = resolvePathInWorkspace(path, root);
        if (!resolved.ok) {
          return {
            content: [{ type: 'text', text: resolved.reason }],
            isError: true,
          };
        }
        cwd = resolved.resolved;
      }
      const result = await collectDiagnostics(cwd, { prefer });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                engine: result.engine,
                cwd: result.cwd,
                count: result.diagnostics.length,
                skipped: result.skipped,
                diagnostics: result.diagnostics.slice(0, 200),
                note:
                  result.diagnostics.length > 200
                    ? 'truncated to 200 diagnostics'
                    : undefined,
              },
              null,
              2
            ),
          },
        ],
        isError: Boolean(result.skipped && result.engine === 'none'),
      };
    },
  });
}
