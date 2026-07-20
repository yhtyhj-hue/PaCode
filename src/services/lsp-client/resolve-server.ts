/**
 * 多语言 LSP 发现 — 有二进制才返回；无则 null（工具回退 tsc/eslint）
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export type LspLanguageId = 'typescript' | 'javascript' | 'python' | 'go' | 'rust';

export interface LspServerCommand {
  command: string;
  args: string[];
  languageId: LspLanguageId;
}

const EXT_TO_LANG: Record<string, LspLanguageId> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
};

function which(bin: string): string | null {
  const r = spawnSync('which', [bin], { encoding: 'utf-8' });
  if (r.status !== 0) return null;
  const path = r.stdout.trim();
  return path || null;
}

function envOverride(
  lang: LspLanguageId,
  env: NodeJS.ProcessEnv
): LspServerCommand | null {
  const key = `PACODE_LSP_${lang.toUpperCase()}`;
  const raw = env[key]?.trim();
  if (!raw) return null;
  const parts = raw.split(/\s+/).filter(Boolean);
  const command = parts[0];
  if (!command) return null;
  return { command, args: parts.slice(1), languageId: lang };
}

/** 由文件路径推断语言 */
export function languageIdFromPath(filePath: string): LspLanguageId | null {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  return EXT_TO_LANG[lower.slice(dot)] ?? null;
}

/** 解析可用 language server（env 优先 → local bin → which） */
export function resolveLanguageServer(
  filePathOrLang: string,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): LspServerCommand | null {
  const lang =
    (filePathOrLang in EXT_TO_LANG
      ? EXT_TO_LANG[filePathOrLang]
      : languageIdFromPath(filePathOrLang)) ??
    (['typescript', 'javascript', 'python', 'go', 'rust'].includes(filePathOrLang)
      ? (filePathOrLang as LspLanguageId)
      : null);
  if (!lang) return null;

  const fromEnv = envOverride(lang, env);
  if (fromEnv) return fromEnv;

  if (lang === 'typescript' || lang === 'javascript') {
    const localBin = join(cwd, 'node_modules', '.bin', 'typescript-language-server');
    if (existsSync(localBin)) {
      return { command: localBin, args: ['--stdio'], languageId: lang };
    }
    const globalBin = which('typescript-language-server');
    if (globalBin) return { command: globalBin, args: ['--stdio'], languageId: lang };
    return null;
  }

  if (lang === 'python') {
    for (const bin of ['pyright-langserver', 'pyright', 'pylsp']) {
      const path = which(bin);
      if (path) {
        const args = bin === 'pyright' || bin === 'pyright-langserver' ? ['--stdio'] : [];
        return { command: path, args, languageId: 'python' };
      }
    }
    return null;
  }

  if (lang === 'go') {
    const path = which('gopls');
    return path ? { command: path, args: [], languageId: 'go' } : null;
  }

  if (lang === 'rust') {
    const path = which('rust-analyzer');
    return path ? { command: path, args: [], languageId: 'rust' } : null;
  }

  return null;
}

/** 兼容旧 API：仅 TS */
export function resolveTypescriptServerCommand(
  cwd = process.cwd()
): { command: string; args: string[] } | null {
  const r = resolveLanguageServer('typescript', cwd);
  return r ? { command: r.command, args: r.args } : null;
}

/** 探测是否可启动 TS LSP（不等 initialize）— 供 skipIf */
export function canStartTypescriptLsp(cwd = process.cwd()): boolean {
  return resolveTypescriptServerCommand(cwd) != null;
}
