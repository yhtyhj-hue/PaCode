/**
 * I6 — 真 Subagent + worktree 隔离（非 prefetch workers）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  SubagentManager,
  registryWithoutTask,
  formatSubagentReport,
} from '../src/agent/subagent.js';
import { QueryEngine } from '../src/agent/engine.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { PermissionMode, ToolDefinition } from '../src/pkg/types.js';
import { WorktreeManager, resetWorktreeManager } from '../src/cli/worktree.js';
import { registerBashTool } from '../src/tools/bash.js';
import { registerGlobTool } from '../src/tools/glob.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
} from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

function initTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pacode-i6-'));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'i6@test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'i6'], { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'marker.txt'), 'from-main-tree\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('I6 registryWithoutTask', () => {
  it('strips Task to prevent nested fan-out', () => {
    const reg = new ToolRegistry();
    reg.register(stubTool('Read'));
    reg.register(stubTool('Task'));
    const filtered = registryWithoutTask(reg);
    expect(filtered.list().map((t) => t.name).sort()).toEqual(['Read']);
  });
});

describe('I6 formatSubagentReport', () => {
  it('includes fixed JSON schema for parent merge', () => {
    const text = formatSubagentReport({
      agent: 'explore',
      success: true,
      summary: 'ok',
      toolCalls: 2,
      durationMs: 10,
      isolation: 'worktree',
      worktree: { name: 'pacode-sub-x', path: '/tmp/wt', kept: false },
    });
    expect(text).toContain('isolation=worktree');
    expect(text).toContain('"agent":"explore"');
    expect(text).toContain('"isolation":"worktree"');
  });
});

describe('I6 QueryEngine workingDirectory', () => {
  it('passes workingDirectory into tool context (no process.chdir)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacode-cwd-'));
    const reg = new ToolRegistry();
    let seenCwd = '';
    reg.register({
      name: 'CaptureCwd',
      description: 'capture',
      inputSchema: {},
      concurrencySafe: true,
      permissionMode: PermissionMode.BYPASS,
      async execute(_input, ctx) {
        seenCwd = ctx.workingDirectory;
        return { content: [{ type: 'text', text: ctx.workingDirectory }] };
      },
    });

    const { toolUseScenario } = await import('./helpers/mock-anthropic.js');
    const client = createMockAnthropicClient([
      toolUseScenario('t1', 'CaptureCwd', {}),
      textEndTurnScenario('done'),
    ]);

    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: reg,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      workingDirectory: dir,
      permissionPrompt: async () => true,
    });

    const session = {
      sessionId: 'cwd-test',
      messages: [{ role: 'user' as const, content: 'go', timestamp: Date.now() }],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.BYPASS,
      hooks: { hooks: {} },
      compactionHistory: [],
    };

    for await (const _ of engine.query({}, session)) {
      /* drain */
    }

    expect(seenCwd).toBe(dir);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('I6 Bash respects ToolContext cwd', () => {
  it('runs command inside workingDirectory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacode-bash-cwd-'));
    writeFileSync(join(dir, 'hello.txt'), 'in-worktree\n');
    const reg = new ToolRegistry();
    registerBashTool(reg);
    const result = await reg.execute(
      { id: '1', name: 'Bash', input: { command: 'cat hello.txt' } },
      { workingDirectory: dir, sessionState: {} as never, hooks: {} as never }
    );
    expect(result.isError).toBeFalsy();
    expect((result.content[0] as { text: string }).text.trim()).toBe('in-worktree');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('I6 Subagent worktree isolation', () => {
  let repoRoot: string;
  let manager: SubagentManager;

  beforeEach(() => {
    resetWorktreeManager();
    repoRoot = initTempGitRepo();
    manager = new SubagentManager();
    manager.register({
      name: 'iso',
      description: 'isolated',
      mode: PermissionMode.BYPASS,
      tools: ['Bash'],
    });
  });

  afterEach(() => {
    resetWorktreeManager();
    if (repoRoot && existsSync(repoRoot)) {
      // prune leftover worktrees
      try {
        const wt = new WorktreeManager(repoRoot);
        for (const w of wt.list()) {
          if (!w.isMain && w.name.startsWith('pacode-sub-')) {
            wt.remove(w.name, { deleteBranch: true });
          }
        }
      } catch {
        /* ignore */
      }
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('createEphemeral + run isolates engine cwd from parent tree', async () => {
    writeFileSync(join(repoRoot, 'dirty-only.txt'), 'should-not-see\n');

    const wtManager = new WorktreeManager(repoRoot);
    const parentReg = new ToolRegistry();
    parentReg.register(stubTool('Bash'));

    let engineCwd = '';
    let sawDirtyInWorktree = true;
    let sawMarkerInWorktree = false;
    const result = await manager.run(manager.get('iso')!, 'list files', {
      toolRegistry: parentReg,
      isolateWorktree: true,
      keepWorktree: true, // 断言文件边界后再手动清理
      repoRoot,
      worktreeManager: wtManager,
      createEngine: (opts) => {
        engineCwd = opts.workingDirectory ?? '';
        sawDirtyInWorktree = existsSync(join(engineCwd, 'dirty-only.txt'));
        sawMarkerInWorktree = existsSync(join(engineCwd, 'marker.txt'));
        const client = createMockAnthropicClient([textEndTurnScenario('listed')]);
        return new QueryEngine({
          ...opts,
          anthropicClient: client,
          contextAssembler: stubAssembler(),
          compactionPipeline: passthroughCompaction(),
        });
      },
    });

    expect(result.success).toBe(true);
    expect(result.report.isolation).toBe('worktree');
    expect(engineCwd).toBe(result.report.worktree?.path);
    expect(engineCwd).not.toBe(repoRoot);
    expect(sawDirtyInWorktree).toBe(false);
    expect(sawMarkerInWorktree).toBe(true);
    expect(readFileSync(join(repoRoot, 'dirty-only.txt'), 'utf8')).toContain('should-not-see');
    if (result.worktreeName) {
      wtManager.remove(result.worktreeName, { deleteBranch: true });
    }
  });

  it('removes ephemeral worktree by default', async () => {
    const wtManager = new WorktreeManager(repoRoot);
    let engineCwd = '';
    const result = await manager.run(manager.get('iso')!, 'cleanup', {
      isolateWorktree: true,
      repoRoot,
      worktreeManager: wtManager,
      createEngine: (opts) => {
        engineCwd = opts.workingDirectory ?? '';
        const client = createMockAnthropicClient([textEndTurnScenario('ok')]);
        return new QueryEngine({
          ...opts,
          anthropicClient: client,
          contextAssembler: stubAssembler(),
          compactionPipeline: passthroughCompaction(),
        });
      },
    });

    expect(result.report.worktree?.kept).toBe(false);
    expect(engineCwd).toBeTruthy();
    expect(existsSync(engineCwd)).toBe(false);
  });

  it('keepWorktree leaves directory for inspection', async () => {
    const wtManager = new WorktreeManager(repoRoot);
    const result = await manager.run(manager.get('iso')!, 'keep me', {
      isolateWorktree: true,
      keepWorktree: true,
      repoRoot,
      worktreeManager: wtManager,
      createEngine: (opts) => {
        const client = createMockAnthropicClient([textEndTurnScenario('ok')]);
        return new QueryEngine({
          ...opts,
          anthropicClient: client,
          contextAssembler: stubAssembler(),
          compactionPipeline: passthroughCompaction(),
        });
      },
    });

    expect(result.report.worktree?.kept).toBe(true);
    expect(result.worktreePath && existsSync(result.worktreePath)).toBe(true);
    if (result.worktreeName) {
      wtManager.remove(result.worktreeName, { deleteBranch: true });
    }
  });

  it('falls back to cwd isolation when not a git repo', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'pacode-nongit-'));
    const wtManager = new WorktreeManager(plain);
    expect(wtManager.isGitRepo()).toBe(false);

    const result = await manager.run(manager.get('iso')!, 'no git', {
      isolateWorktree: true,
      workingDirectory: plain,
      worktreeManager: wtManager,
      createEngine: (opts) => {
        expect(opts.workingDirectory).toBe(plain);
        const client = createMockAnthropicClient([textEndTurnScenario('ok')]);
        return new QueryEngine({
          ...opts,
          anthropicClient: client,
          contextAssembler: stubAssembler(),
          compactionPipeline: passthroughCompaction(),
        });
      },
    });

    expect(result.report.isolation).toBe('cwd');
    expect(result.report.worktree).toBeUndefined();
    rmSync(plain, { recursive: true, force: true });
  });
});

describe('I6 Glob uses workingDirectory', () => {
  it('searches under ctx root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacode-glob-'));
    writeFileSync(join(dir, 'found.ts'), 'x');
    const reg = new ToolRegistry();
    registerGlobTool(reg);
    const result = await reg.execute(
      { id: '1', name: 'Glob', input: { pattern: '*.ts' } },
      { workingDirectory: dir, sessionState: {} as never, hooks: {} as never }
    );
    expect((result.content[0] as { text: string }).text).toContain('found.ts');
    rmSync(dir, { recursive: true, force: true });
  });
});

function stubTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: {},
    concurrencySafe: true,
    permissionMode: PermissionMode.BYPASS,
    async execute() {
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
}
