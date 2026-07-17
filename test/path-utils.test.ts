import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePathInWorkspace } from '../src/tools/path-utils.js';

let root: string;
let outside: string;

beforeEach(() => {
  root = join(tmpdir(), `pacode-pu-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  outside = join(tmpdir(), `pacode-pu-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  if (existsSync(outside)) rmSync(outside, { recursive: true, force: true });
});

describe('resolvePathInWorkspace', () => {
  it('accepts paths inside workspace', () => {
    const r = resolvePathInWorkspace('foo.txt', root);
    expect(r.ok).toBe(true);
  });

  it('rejects .. escape (lexical)', () => {
    const r = resolvePathInWorkspace('../etc/passwd', root);
    expect(r.ok).toBe(false);
  });

  it('rejects absolute path outside workspace', () => {
    const r = resolvePathInWorkspace(join(outside, 'secret.txt'), root);
    expect(r.ok).toBe(false);
  });

  // Regression: symlink inside workspace pointing outside must be rejected.
  it('rejects symlink inside workspace that points outside', () => {
    const linkPath = join(root, 'escape');
    try {
      symlinkSync(outside, linkPath);
    } catch {
      // Some filesystems may not support symlinks; skip
      return;
    }
    const r = resolvePathInWorkspace('escape', root);
    expect(r.ok).toBe(false);
  });

  // P0: symlink 目录 + 尚未创建的子文件不得 fail-open 写出工作区
  it('rejects nested path under symlink directory that points outside', () => {
    try {
      symlinkSync(outside, join(root, 'link'));
    } catch {
      return;
    }
    const r = resolvePathInWorkspace('link/newfile.txt', root);
    expect(r.ok).toBe(false);
  });
});