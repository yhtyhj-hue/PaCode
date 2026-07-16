/**
 * K4 P2 — NotebookEdit / ScheduleCron / LSP diagnostics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerNotebookEditTool } from '../src/tools/notebook-edit.js';
import { registerScheduleCronTool } from '../src/tools/schedule-cron.js';
import { registerLspTool } from '../src/tools/lsp.js';
import { registerCoreTools } from '../src/tools/bootstrap.js';
import {
  CronStore,
  resetCronStore,
  parseScheduleIntervalMs,
} from '../src/services/cron/index.js';
import { parseTscOutput, collectDiagnostics } from '../src/services/diagnostics/index.js';
import { PermissionMode } from '../src/pkg/types.js';

const ctxFor = (cwd: string) => ({
  workingDirectory: cwd,
  sessionState: {} as never,
  hooks: {} as never,
});

const sampleNb = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells: [
    {
      cell_type: 'markdown',
      metadata: {},
      source: ['# Title\n'],
    },
    {
      cell_type: 'code',
      metadata: {},
      execution_count: null,
      outputs: [],
      source: ['print(1)\n'],
    },
  ],
};

describe('K4 NotebookEdit', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `pacode-nb-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'demo.ipynb'), JSON.stringify(sampleNb, null, 1));
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('edits a cell and persists', async () => {
    const reg = new ToolRegistry();
    registerNotebookEditTool(reg);
    const result = await reg.execute(
      {
        id: '1',
        name: 'NotebookEdit',
        input: {
          path: 'demo.ipynb',
          action: 'edit_cell',
          cell_idx: 1,
          source: 'print(2)\n',
        },
      },
      ctxFor(dir)
    );
    expect(result.isError).toBeFalsy();
    const nb = JSON.parse(readFileSync(join(dir, 'demo.ipynb'), 'utf-8'));
    expect(nb.cells[1].source.join('')).toContain('print(2)');
  });

  it('rejects out-of-range cell_idx', async () => {
    const reg = new ToolRegistry();
    registerNotebookEditTool(reg);
    const result = await reg.execute(
      {
        id: '1',
        name: 'NotebookEdit',
        input: { path: 'demo.ipynb', action: 'edit_cell', cell_idx: 9, source: 'x' },
      },
      ctxFor(dir)
    );
    expect(result.isError).toBe(true);
  });

  it('inserts and deletes cells', async () => {
    const reg = new ToolRegistry();
    registerNotebookEditTool(reg);
    await reg.execute(
      {
        id: '1',
        name: 'NotebookEdit',
        input: {
          path: 'demo.ipynb',
          action: 'insert_cell',
          cell_idx: 1,
          cell_type: 'code',
          source: 'x=1',
        },
      },
      ctxFor(dir)
    );
    let nb = JSON.parse(readFileSync(join(dir, 'demo.ipynb'), 'utf-8'));
    expect(nb.cells).toHaveLength(3);
    await reg.execute(
      {
        id: '2',
        name: 'NotebookEdit',
        input: { path: 'demo.ipynb', action: 'delete_cell', cell_idx: 1 },
      },
      ctxFor(dir)
    );
    nb = JSON.parse(readFileSync(join(dir, 'demo.ipynb'), 'utf-8'));
    expect(nb.cells).toHaveLength(2);
  });
});

describe('K4 ScheduleCron', () => {
  let storePath: string;
  let store: CronStore;

  beforeEach(() => {
    resetCronStore();
    storePath = join(tmpdir(), `pacode-cron-${Date.now()}.json`);
    store = new CronStore(storePath);
  });

  afterEach(() => {
    resetCronStore();
    if (existsSync(storePath)) rmSync(storePath, { force: true });
  });

  it('parses every:5m', () => {
    expect(parseScheduleIntervalMs('every:5m')).toBe(5 * 60 * 1000);
    expect(parseScheduleIntervalMs('bad')).toBeNull();
  });

  it('create/list/delete round-trip', async () => {
    const reg = new ToolRegistry();
    registerScheduleCronTool(reg, { store, now: () => 1_000_000 });
    const created = await reg.execute(
      {
        id: '1',
        name: 'ScheduleCron',
        input: { action: 'create', expression: 'every:5m', prompt: 'run checks' },
      },
      ctxFor(process.cwd())
    );
    expect(created.isError).toBeFalsy();
    const job = JSON.parse((created.content[0] as { text: string }).text).job;
    expect(job.nextRunAt).toBe(1_000_000 + 5 * 60 * 1000);

    const listed = await reg.execute(
      { id: '2', name: 'ScheduleCron', input: { action: 'list' } },
      ctxFor(process.cwd())
    );
    expect((listed.content[0] as { text: string }).text).toContain(job.id);

    const del = await reg.execute(
      { id: '3', name: 'ScheduleCron', input: { action: 'delete', job_id: job.id } },
      ctxFor(process.cwd())
    );
    expect(del.isError).toBeFalsy();
    expect(store.list()).toHaveLength(0);
  });

  it('due fires once and advances nextRunAt', () => {
    const job = store.create({
      expression: 'every:1m',
      prompt: 'tick',
      now: 0,
    });
    expect(job.nextRunAt).toBe(60_000);
    const first = store.due(60_000);
    expect(first).toHaveLength(1);
    expect(first[0]?.prompt).toBe('tick');
    const again = store.due(60_000);
    expect(again).toHaveLength(0);
    expect(store.get(job.id)?.nextRunAt).toBe(120_000);
  });
});

describe('K4 LSP / diagnostics', () => {
  it('parseTscOutput extracts diagnostics', () => {
    const text = `src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/b.ts(1,1): warning TS6133: 'x' is declared but its value is never read.`;
    const diags = parseTscOutput(text, '/proj');
    expect(diags).toHaveLength(2);
    expect(diags[0]?.severity).toBe('error');
    expect(diags[0]?.line).toBe(10);
    expect(diags[1]?.severity).toBe('warning');
  });

  it('collectDiagnostics skips when no tsconfig/eslint', async () => {
    const dir = join(tmpdir(), `pacode-diag-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const result = await collectDiagnostics(dir);
    expect(result.engine).toBe('none');
    expect(result.skipped).toContain('No tsconfig');
    rmSync(dir, { recursive: true, force: true });
  });

  it('LSP tool returns skip for empty project', async () => {
    const dir = join(tmpdir(), `pacode-lsp-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const reg = new ToolRegistry();
    registerLspTool(reg);
    const result = await reg.execute(
      { id: '1', name: 'LSP', input: { action: 'diagnostics', path: dir } },
      ctxFor(dir)
    );
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('engine');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('K4 bootstrap', () => {
  it('registers NotebookEdit, ScheduleCron, LSP (28 tools)', () => {
    const reg = new ToolRegistry();
    registerCoreTools(reg, { task: { toolRegistry: reg } });
    expect(reg.has('NotebookEdit')).toBe(true);
    expect(reg.has('ScheduleCron')).toBe(true);
    expect(reg.has('LSP')).toBe(true);
    expect(reg.get('NotebookEdit')?.permissionMode).toBe(PermissionMode.ACCEPT_EDITS);
    expect(reg.list()).toHaveLength(28);
  });
});
