/**
 * 工作区路径解析 — 阻止 ../ 逃逸与 symlink 跳出 workingDirectory
 */

import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { realpathSync } from 'node:fs';

export type PathResolveResult =
  | { ok: true; resolved: string }
  | { ok: false; reason: string };

/** 将用户路径解析到 workingDirectory 内；绝对路径与 symlink 跳出均拒绝 */
export function resolvePathInWorkspace(
  path: string,
  workingDirectory: string
): PathResolveResult {
  const root = resolve(workingDirectory);
  const resolvedRaw = isAbsolute(path) ? resolve(path) : resolve(root, path);

  // 词法层面已逃逸（无 realpath 调用）
  const relLex = relative(root, resolvedRaw);
  if (relLex.startsWith('..') || isAbsolute(relLex)) {
    return { ok: false, reason: `Path escapes workspace: ${path}` };
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return { ok: false, reason: `Invalid workspace: ${workingDirectory}` };
  }

  // 沿路径向上找最长已存在前缀并 realpath —— 避免「symlink 目录 + 新文件」fail-open 逃逸
  let probe = resolvedRaw;
  let resolvedAncestor: string | null = null;
  for (;;) {
    try {
      resolvedAncestor = realpathSync(probe);
      break;
    } catch {
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }

  if (resolvedAncestor === null) {
    return { ok: true, resolved: resolvedRaw };
  }

  const relReal = relative(realRoot, resolvedAncestor);
  if (relReal.startsWith('..') || isAbsolute(relReal)) {
    return { ok: false, reason: `Symlink escapes workspace: ${path}` };
  }

  return { ok: true, resolved: resolvedRaw };
}
