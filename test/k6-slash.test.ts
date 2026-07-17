/**
 * K6 — 高频 slash：菜单对齐 + /doctor + /diff
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  BUILTIN_SLASH_COMMANDS,
  filterSlashCommands,
  completeSlashCommand,
} from '../src/cli/slash-menu.js';
import { formatDoctorReport, runDoctorChecks } from '../src/cli/doctor.js';
import { formatGitDiffView } from '../src/cli/git-diff-view.js';

describe('K6 slash menu sync', () => {
  it('exposes resume/rewind/style/doctor/diff and aliases', () => {
    const names = BUILTIN_SLASH_COMMANDS.map((e) => e.command);
    for (const cmd of [
      '/resume',
      '/rewind',
      '/style',
      '/doctor',
      '/diff',
      '/reset',
      '/quit',
      '/effort',
      '/vim',
      '/new',
    ]) {
      expect(names).toContain(cmd);
    }
  });

  it('filters /doc to /doctor', () => {
    expect(filterSlashCommands('/doc').map((e) => e.command)).toEqual(['/doctor']);
  });

  it('tab-completes /rew to /rewind', () => {
    expect(completeSlashCommand('/rew')).toBe('/rewind');
  });
});

describe('K6 doctor', () => {
  it('reports api_key and skills checks', () => {
    const checks = runDoctorChecks({
      cwd: process.cwd(),
      hasApiKey: true,
      model: 'test-model',
      mode: 'default',
      mcpConnected: 0,
      mcpTools: 0,
      skillsCount: 3,
    });
    expect(checks.find((c) => c.id === 'api_key')?.ok).toBe(true);
    expect(checks.find((c) => c.id === 'skills')?.ok).toBe(true);
    expect(formatDoctorReport(checks)).toContain('checks ok');
  });

  it('flags missing api key', () => {
    const checks = runDoctorChecks({ hasApiKey: false, skillsCount: 0 });
    expect(checks.find((c) => c.id === 'api_key')?.ok).toBe(false);
  });
});

describe('K6 git diff view', () => {
  it('returns not-a-repo outside git', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacode-nodiff-'));
    expect(formatGitDiffView(dir)).toContain('Not a git repository');
    rmSync(dir, { recursive: true, force: true });
  });

  it('shows status for a temp git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacode-diff-'));
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'k6@test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'k6'], { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, 'a.txt'), 'hello\n');
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, 'a.txt'), 'hello\nworld\n');

    const view = formatGitDiffView(dir);
    expect(view).toContain('git status');
    expect(view).toContain('Read-only');
    expect(view).not.toContain('git commit -m');

    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });
});
