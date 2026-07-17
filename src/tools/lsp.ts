/**
 * K4: Diagnostics tool (+ LSP alias) — 无 language server；封装 tsc/eslint
 */

import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';
import { collectDiagnostics } from '../services/diagnostics/index.js';
import { resolvePathInWorkspace } from './path-utils.js';

async function executeDiagnostics(
  input: Record<string, unknown>,
  ctx?: ToolContext
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
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
              result.diagnostics.length > 200 ? 'truncated to 200 diagnostics' : undefined,
          },
          null,
          2
        ),
      },
    ],
    isError: Boolean(result.skipped && result.engine === 'none'),
  };
}

const diagnosticsSchema = {
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
};

export function registerLspTool(registry: { register: (t: ToolDefinition) => void }): void {
  // 主名 Diagnostics：诚实命名；LSP 保留为兼容别名
  registry.register({
    name: 'Diagnostics',
    description:
      'Collect project diagnostics (runs tsc --noEmit or eslint). Not a language server client.',
    inputSchema: diagnosticsSchema,
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    execute: executeDiagnostics,
  });

  registry.register({
    name: 'LSP',
    description:
      'Alias of Diagnostics. Collect tsc/eslint diagnostics — not a full LSP client (go-to-def/hover unsupported).',
    inputSchema: diagnosticsSchema,
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    execute: executeDiagnostics,
  });
}
