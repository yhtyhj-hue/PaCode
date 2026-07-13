/**
 * 工作区路径解析 — 阻止 ../ 逃逸 workingDirectory
 */

import { isAbsolute, relative, resolve } from 'node:path';

export type PathResolveResult =
  | { ok: true; resolved: string }
  | { ok: false; reason: string };

/** 将用户路径解析到 workingDirectory 内；绝对路径也必须在根目录下 */
export function resolvePathInWorkspace(
  path: string,
  workingDirectory: string
): PathResolveResult {
  const root = resolve(workingDirectory);
  const resolved = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const rel = relative(root, resolved);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, reason: `Path escapes workspace: ${path}` };
  }

  return { ok: true, resolved };
}
