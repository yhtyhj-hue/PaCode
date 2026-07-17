/**
 * K4: Diagnostics / LSP — 优先真 LSP client；无 server 时回退 tsc/eslint
 */

import { readFileSync } from 'node:fs';
import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';
import { collectDiagnostics } from '../services/diagnostics/index.js';
import {
  LspClient,
  resolveTypescriptServerCommand,
  type LspPosition,
} from '../services/lsp-client/index.js';
import { resolvePathInWorkspace } from './path-utils.js';

async function executeDiagnostics(
  input: Record<string, unknown>,
  ctx?: ToolContext
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const {
    action = 'diagnostics',
    prefer,
    path,
    line,
    character,
  } = input as {
    action?: 'diagnostics' | 'hover' | 'definition';
    prefer?: 'tsc' | 'eslint' | 'lsp';
    path?: string;
    line?: number;
    character?: number;
  };

  const root = ctx?.workingDirectory ?? process.cwd();

  if (action === 'hover' || action === 'definition') {
    return runLspAction(action, root, path, line, character);
  }

  if (action !== 'diagnostics') {
    return {
      content: [{ type: 'text', text: `Unknown action: ${action}` }],
      isError: true,
    };
  }

  // prefer=lsp 或默认：先试 LSP；失败回退 tsc/eslint
  if (prefer === 'lsp' || prefer == null) {
    const lspDiag = await tryLspDiagnostics(root, path);
    if (lspDiag) return lspDiag;
  }

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
  const result = await collectDiagnostics(cwd, {
    prefer: prefer === 'lsp' ? undefined : prefer,
  });
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
            fallback: 'tsc/eslint (no LSP server)',
          },
          null,
          2
        ),
      },
    ],
    isError: Boolean(result.skipped && result.engine === 'none'),
  };
}

async function tryLspDiagnostics(
  root: string,
  path?: string
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean } | null> {
  const cmd = resolveTypescriptServerCommand(root);
  if (!cmd) return null;
  const client = new LspClient();
  const ok = await client.start(cmd.command, cmd.args, root);
  if (!ok) return null;
  try {
    // LSP publishDiagnostics 异步；此处仅证明 client 可 initialize
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              engine: 'lsp',
              contract: client.contract,
              cwd: root,
              path: path ?? null,
              note: 'LSP server started; use action=hover|definition for positions. Full push diagnostics not buffered yet — fallback engines still available via prefer=tsc|eslint.',
              count: 0,
              diagnostics: [],
            },
            null,
            2
          ),
        },
      ],
    };
  } finally {
    await client.stop();
  }
}

async function runLspAction(
  action: 'hover' | 'definition',
  root: string,
  path: string | undefined,
  line: number | undefined,
  character: number | undefined
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (!path) {
    return {
      content: [{ type: 'text', text: `${action} requires path` }],
      isError: true,
    };
  }
  const resolved = resolvePathInWorkspace(path, root);
  if (!resolved.ok) {
    return { content: [{ type: 'text', text: resolved.reason }], isError: true };
  }
  const position: LspPosition = {
    line: line ?? 0,
    character: character ?? 0,
  };
  const cmd = resolveTypescriptServerCommand(root);
  if (!cmd) {
    // 无 LSP：diagnostics 回退；hover/definition 明确失败
    const fallback = await collectDiagnostics(root);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: 'No typescript-language-server; install it or use action=diagnostics',
              fallbackEngine: fallback.engine,
              fallbackCount: fallback.diagnostics.length,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  const client = new LspClient();
  const ok = await client.start(cmd.command, cmd.args, root);
  if (!ok) {
    return {
      content: [{ type: 'text', text: 'Failed to start language server' }],
      isError: true,
    };
  }
  try {
    const text = readFileSync(resolved.resolved, 'utf-8');
    const lang = resolved.resolved.endsWith('.tsx')
      ? 'typescriptreact'
      : resolved.resolved.endsWith('.js')
        ? 'javascript'
        : 'typescript';
    await client.openDocument(resolved.resolved, text, lang);
    if (action === 'hover') {
      const hover = await client.hover(resolved.resolved, position);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { action, path: resolved.resolved, position, hover, contract: client.contract },
              null,
              2
            ),
          },
        ],
      };
    }
    const locations = await client.definition(resolved.resolved, position);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { action, path: resolved.resolved, position, locations, contract: client.contract },
            null,
            2
          ),
        },
      ],
    };
  } finally {
    await client.stop();
  }
}

const diagnosticsSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['diagnostics', 'hover', 'definition'],
      description: 'diagnostics (default) | hover | definition',
    },
    prefer: {
      type: 'string',
      enum: ['tsc', 'eslint', 'lsp'],
      description: 'Prefer engine; lsp falls back to tsc/eslint when unavailable',
    },
    path: {
      type: 'string',
      description: 'File path (hover/definition) or workspace root (diagnostics)',
    },
    line: {
      type: 'number',
      description: '0-based line for hover/definition',
    },
    character: {
      type: 'number',
      description: '0-based character for hover/definition',
    },
  },
};

export function registerLspTool(registry: { register: (t: ToolDefinition) => void }): void {
  registry.register({
    name: 'Diagnostics',
    description:
      'Project diagnostics via LSP (typescript-language-server) or tsc/eslint fallback. Actions: diagnostics, hover, definition.',
    inputSchema: diagnosticsSchema,
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    execute: executeDiagnostics,
  });

  registry.register({
    name: 'LSP',
    description:
      'Alias for Diagnostics (hover|definition|diagnostics). Uses real LSP when installed; else tsc/eslint.',
    inputSchema: diagnosticsSchema,
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    execute: executeDiagnostics,
  });
}
