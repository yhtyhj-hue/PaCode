/**
 * K4: NotebookEdit — 编辑 .ipynb JSON（不跑 kernel）
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ToolDefinition, PermissionMode, ToolContext } from '../pkg/types.js';
import { resolvePathInWorkspace } from './path-utils.js';

interface NbCell {
  cell_type: string;
  source: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

interface Notebook {
  cells: NbCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
}

function cellSourceToString(source: string | string[]): string {
  return Array.isArray(source) ? source.join('') : source;
}

function stringToCellSource(text: string): string[] {
  if (text.length === 0) return [];
  // Jupyter 惯例：按行拆分，保留换行符在行尾（末行除外可无）
  const lines = text.split('\n');
  return lines.map((line, i) => (i < lines.length - 1 ? `${line}\n` : line));
}

export function loadNotebook(path: string): Notebook {
  const raw = readFileSync(path, 'utf-8');
  const nb = JSON.parse(raw) as Notebook;
  if (!Array.isArray(nb.cells)) {
    throw new Error('Invalid notebook: missing cells array');
  }
  return nb;
}

export function saveNotebook(path: string, nb: Notebook): void {
  writeFileSync(path, JSON.stringify(nb, null, 1) + '\n', 'utf-8');
}

export function registerNotebookEditTool(registry: {
  register: (t: ToolDefinition) => void;
}): void {
  registry.register({
    name: 'NotebookEdit',
    description:
      'Edit Jupyter .ipynb notebooks (edit/insert/delete/list cells). Does not execute cells.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to .ipynb file' },
        action: {
          type: 'string',
          enum: ['edit_cell', 'insert_cell', 'delete_cell', 'list_cells'],
        },
        cell_idx: { type: 'number', description: '0-based cell index' },
        cell_type: {
          type: 'string',
          enum: ['code', 'markdown', 'raw'],
          description: 'For insert_cell (default code)',
        },
        source: { type: 'string', description: 'New cell source (edit/insert)' },
      },
      required: ['path', 'action'],
    },
    concurrencySafe: false,
    permissionMode: PermissionMode.ACCEPT_EDITS,
    async execute(input, ctx?: ToolContext) {
      const {
        path,
        action,
        cell_idx: cellIdx,
        cell_type: cellType = 'code',
        source,
      } = input as {
        path: string;
        action: 'edit_cell' | 'insert_cell' | 'delete_cell' | 'list_cells';
        cell_idx?: number;
        cell_type?: 'code' | 'markdown' | 'raw';
        source?: string;
      };

      const root = ctx?.workingDirectory ?? process.cwd();
      const resolved = resolvePathInWorkspace(path, root);
      if (!resolved.ok) {
        return { content: [{ type: 'text', text: resolved.reason }], isError: true };
      }
      if (!resolved.resolved.endsWith('.ipynb')) {
        return {
          content: [{ type: 'text', text: 'NotebookEdit only supports .ipynb files' }],
          isError: true,
        };
      }
      if (!existsSync(resolved.resolved)) {
        return {
          content: [{ type: 'text', text: `Notebook not found: ${path}` }],
          isError: true,
        };
      }

      try {
        const nb = loadNotebook(resolved.resolved);

        if (action === 'list_cells') {
          const cells = nb.cells.map((c, i) => ({
            index: i,
            cell_type: c.cell_type,
            preview: cellSourceToString(c.source).slice(0, 120),
          }));
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ path: resolved.resolved, cell_count: cells.length, cells }, null, 2),
              },
            ],
          };
        }

        if (typeof cellIdx !== 'number' || cellIdx < 0 || !Number.isInteger(cellIdx)) {
          return {
            content: [{ type: 'text', text: 'cell_idx must be a non-negative integer' }],
            isError: true,
          };
        }

        if (action === 'edit_cell') {
          if (cellIdx >= nb.cells.length) {
            return {
              content: [
                {
                  type: 'text',
                  text: `cell_idx ${cellIdx} out of range (0..${nb.cells.length - 1})`,
                },
              ],
              isError: true,
            };
          }
          if (typeof source !== 'string') {
            return {
              content: [{ type: 'text', text: 'source required for edit_cell' }],
              isError: true,
            };
          }
          nb.cells[cellIdx]!.source = stringToCellSource(source);
          saveNotebook(resolved.resolved, nb);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ok: true,
                  action,
                  path: resolved.resolved,
                  cell_idx: cellIdx,
                }),
              },
            ],
          };
        }

        if (action === 'insert_cell') {
          if (cellIdx > nb.cells.length) {
            return {
              content: [
                {
                  type: 'text',
                  text: `cell_idx ${cellIdx} out of range for insert (0..${nb.cells.length})`,
                },
              ],
              isError: true,
            };
          }
          const cell: NbCell = {
            cell_type: cellType,
            source: stringToCellSource(source ?? ''),
            metadata: {},
          };
          if (cellType === 'code') {
            cell.outputs = [];
            cell.execution_count = null;
          }
          nb.cells.splice(cellIdx, 0, cell);
          saveNotebook(resolved.resolved, nb);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ok: true,
                  action,
                  path: resolved.resolved,
                  cell_idx: cellIdx,
                  cell_count: nb.cells.length,
                }),
              },
            ],
          };
        }

        // delete_cell
        if (cellIdx >= nb.cells.length) {
          return {
            content: [
              {
                type: 'text',
                text: `cell_idx ${cellIdx} out of range (0..${nb.cells.length - 1})`,
              },
            ],
            isError: true,
          };
        }
        nb.cells.splice(cellIdx, 1);
        saveNotebook(resolved.resolved, nb);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: true,
                action,
                path: resolved.resolved,
                cell_idx: cellIdx,
                cell_count: nb.cells.length,
              }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  });
}
