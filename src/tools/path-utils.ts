/**
 * 工作区路径解析 — 阻止 ../ 逃逸与 symlink 跳出 workingDirectory
 */

import { isAbsolute, relative, resolve } from 'node:path';
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

  // 真实路径层面检查：防 symlink 跳出。
  // 注意 macOS 上 /var → /private/var 等系统链接：root 词法路径与 realpath 可能差一层，
  // 只要 resolved 的 realpath 仍在 root realpath 之下即视为安全。
  let realRoot: string;
  let resolved: string;
  try {
    realRoot = realpathSync(root);
    resolved = realpathSync(resolvedRaw);
  } catch {
    // realpath 失败（中间目录不存在等）— 落回词法判断（创建场景下仍可用）
    return { ok: true, resolved: resolvedRaw };
  }

  const relReal = relative(realRoot, resolved);
  if (relReal.startsWith('..') || isAbsolute(relReal)) {
    return { ok: false, reason: `Symlink escapes workspace: ${path}` };
  }

  return { ok: true, resolved };
}
