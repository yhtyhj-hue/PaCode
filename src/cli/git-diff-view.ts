/**
 * K6: /diff — 只读 git status + diff --stat（不 commit）
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export function formatGitDiffView(cwd: string = process.cwd()): string {
  const root = resolve(cwd);
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'ignore' });
  } catch {
    return 'Not a git repository.';
  }

  let status = '';
  let stat = '';
  try {
    status = execFileSync('git', ['status', '-sb'], {
      cwd: root,
      encoding: 'utf-8',
      maxBuffer: 2 * 1024 * 1024,
    }).trim();
  } catch (e) {
    status = e instanceof Error ? e.message : String(e);
  }

  try {
    stat = execFileSync('git', ['diff', '--stat', 'HEAD'], {
      cwd: root,
      encoding: 'utf-8',
      maxBuffer: 2 * 1024 * 1024,
    }).trim();
  } catch {
    try {
      stat = execFileSync('git', ['diff', '--stat'], {
        cwd: root,
        encoding: 'utf-8',
        maxBuffer: 2 * 1024 * 1024,
      }).trim();
    } catch (e) {
      stat = e instanceof Error ? e.message : String(e);
    }
  }

  const parts = ['# git status', status || '(clean)', '', '# git diff --stat'];
  parts.push(stat || '(no unstaged/staged diff vs HEAD)');
  parts.push('');
  parts.push('_Read-only. Use git commit manually or ask the agent — /diff does not commit._');
  return parts.join('\n');
}
