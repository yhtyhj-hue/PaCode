/**
 * Project memory paths — `.paude/projects/{hash}/`
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

/** 解析 git 仓库根目录，非 git 项目则回退 cwd */
export function resolveProjectRoot(cwd = process.cwd()): string {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf-8',
    });
    return resolve(out.trim());
  } catch {
    return resolve(cwd);
  }
}

/** 项目路径 hash（稳定、可复现） */
export function computeProjectHash(projectRoot: string): string {
  const normalized = resolve(projectRoot);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/** 项目级 memory 根目录：`.paude/projects/{hash}/` */
export function getProjectMemoryRoot(projectRoot?: string): string {
  const root = resolveProjectRoot(projectRoot);
  return join(root, '.paude', 'projects', computeProjectHash(root));
}

/** 项目 JSON memory 子目录 */
export function getProjectMemoryDir(projectRoot?: string): string {
  return join(getProjectMemoryRoot(projectRoot), 'memory');
}

/** 用户级 memory 目录 */
export function getUserMemoryRoot(): string {
  return join(homedir(), '.paude', 'memory');
}

/** 读取项目 markdown memory（codebase_map / architecture / decisions） */
export function loadProjectMemoryMarkdown(projectRoot?: string): string | null {
  const root = getProjectMemoryRoot(projectRoot);
  if (!existsSync(root)) return null;

  const parts: string[] = [];

  for (const name of ['codebase_map.md', 'architecture.md']) {
    const filePath = join(root, name);
    if (!existsSync(filePath)) continue;
    try {
      parts.push(`### ${name}\n\n${readFileSync(filePath, 'utf-8').trim()}`);
    } catch {
      /* skip */
    }
  }

  const decisionsDir = join(root, 'decisions');
  if (existsSync(decisionsDir)) {
    for (const file of readdirSync(decisionsDir).filter((f) => f.endsWith('.md'))) {
      try {
        const content = readFileSync(join(decisionsDir, file), 'utf-8').trim();
        parts.push(`### decisions/${file}\n\n${content}`);
      } catch {
        /* skip */
      }
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}
