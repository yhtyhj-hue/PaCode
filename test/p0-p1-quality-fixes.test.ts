/**
 * 回归：质检 P0/P1（Bash 确认后可执行、symlink 逃逸、DEFAULT Edit、LSP 边界）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, symlinkSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkBashSecurity,
  createSecureBashExecutor,
  parseShellSegments,
  shouldHardBlockBashExecution,
} from '../src/tools/bash-secure.js';
import { resolvePathInWorkspace } from '../src/tools/path-utils.js';
import { PermissionSystem } from '../src/permission/system.js';
import { PermissionMode } from '../src/pkg/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerEditTool } from '../src/tools/edit.js';
import { registerWriteTool } from '../src/tools/write.js';
import { registerLspTool } from '../src/tools/lsp.js';
import { registerAskUserTool } from '../src/services/ask-user/index.js';
import { formatDagResults } from '../src/services/agent-scheduler/format-results.js';

describe('P0 Bash: confirm ≠ hard-block', () => {
  it('keeps 2>&1 as one segment (redirect, not background &)', () => {
    expect(parseShellSegments('npm test 2>&1 | head -5')).toEqual([
      'npm test 2>&1',
      'head -5',
    ]);
  });

  it('marks npm test as needs-confirm, not hard-deny at exec', () => {
    const check = checkBashSecurity('npm test');
    expect(check.safe).toBe(false);
    expect(check.category).toBe('unknown');
    expect(shouldHardBlockBashExecution(check)).toBe(false);
  });

  it('still hard-blocks destructive at executor', () => {
    const check = checkBashSecurity('rm -rf /');
    expect(shouldHardBlockBashExecution(check)).toBe(true);
  });

  it('executor runs npm after security would have only required confirmation', async () => {
    const exec = createSecureBashExecutor({ timeoutMs: 15000 });
    const result = await exec('npm --version');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  it('DEFAULT permission asks confirm for npm, does not hard-deny', () => {
    const ps = new PermissionSystem();
    const result = ps.check({
      tool: { id: '1', name: 'Bash', input: { command: 'npm test' } },
      mode: PermissionMode.DEFAULT,
      context: {} as never,
    });
    expect(result.allowed).toBe(true);
    expect(result.requiresInteraction).toBe(true);
  });
});

describe('P0 path-utils: symlink dir + new file', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = join(tmpdir(), `pacode-p0-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    outside = join(tmpdir(), `pacode-p0-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    if (existsSync(outside)) rmSync(outside, { recursive: true, force: true });
  });

  it('rejects write via in-workspace symlink directory to new child', () => {
    try {
      symlinkSync(outside, join(root, 'link'));
    } catch {
      return;
    }
    const r = resolvePathInWorkspace('link/newfile.txt', root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Symlink escapes|escapes/i);
  });

  it('still allows creating a new file under a real in-workspace dir', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    const r = resolvePathInWorkspace('src/brand-new.ts', root);
    expect(r.ok).toBe(true);
  });
});

describe('P0 DEFAULT Edit/Write', () => {
  it('Edit/Write register as DEFAULT and confirm in DEFAULT session', () => {
    const reg = new ToolRegistry();
    registerEditTool(reg);
    registerWriteTool(reg);
    expect(reg.get('Edit')?.permissionMode).toBe(PermissionMode.DEFAULT);
    expect(reg.get('Write')?.permissionMode).toBe(PermissionMode.DEFAULT);

    const ps = new PermissionSystem({
      getToolDefinition: (n) => reg.get(n),
    });
    const edit = ps.check({
      tool: { id: '1', name: 'Edit', input: { path: 'a.ts', oldText: 'x', newText: 'y' } },
      mode: PermissionMode.DEFAULT,
      context: {} as never,
    });
    expect(edit.allowed).toBe(true);
    expect(edit.requiresInteraction).toBe(true);

    const write = ps.check({
      tool: { id: '2', name: 'Write', input: { path: 'a.ts', content: 'x' } },
      mode: PermissionMode.DEFAULT,
      context: {} as never,
    });
    expect(write.allowed).toBe(true);
    expect(write.requiresInteraction).toBe(true);
  });
});

describe('P1 LSP path bound + AskUser DEFAULT', () => {
  it('LSP rejects path outside workspace', async () => {
    const reg = new ToolRegistry();
    registerLspTool(reg);
    const outside = join(tmpdir(), `lsp-out-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    try {
      const result = await reg.execute(
        { id: '1', name: 'LSP', input: { path: outside } },
        { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
      );
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toMatch(/escapes/i);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('AskUser is DEFAULT and uses ctx.readLine when provided', async () => {
    const reg = new ToolRegistry();
    registerAskUserTool(reg);
    expect(reg.get('AskUser')?.permissionMode).toBe(PermissionMode.DEFAULT);

    const result = await reg.execute(
      {
        id: '1',
        name: 'AskUser',
        input: {
          question: 'Pick one?',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
      },
      {
        workingDirectory: process.cwd(),
        sessionState: {} as never,
        hooks: {} as never,
        readLine: async () => 'a',
      }
    );
    expect(result.isError).toBeFalsy();
    expect((result.content[0] as { text: string }).text).toContain('selection=a');
  });
});

describe('P0 formatDagResults all-error header', () => {
  it('does not claim audit complete when every prefetch run failed', () => {
    const text = formatDagResults('code_audit', [
      {
        tool: { id: '1', name: 'Bash', input: { command: 'npm test' } },
        result: {
          content: [{ type: 'text', text: 'Unrecognized command requires confirmation' }],
          isError: true,
        },
      },
    ]);
    expect(text).toMatch(/预取未成功|全部失败/);
    expect(text).not.toMatch(/代码审计已完成/);
  });
});

describe('P0 path-utils regression still rejects direct symlink target', () => {
  it('rejects symlink file pointing outside', () => {
    const root = join(tmpdir(), `pacode-sym-${Date.now()}`);
    const outside = join(tmpdir(), `pacode-sym-out-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), 'x');
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'escape'));
    } catch {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
      return;
    }
    const r = resolvePathInWorkspace('escape', root);
    expect(r.ok).toBe(false);
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});
