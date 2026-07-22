/**
 * 从包根 package.json 读取版本 — CLI / MCP client 共用，避免写死版本号
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

/** 解析已安装包根目录的 package.json.version */
export function getPackageVersion(): string {
  if (cached !== undefined) return cached;

  // dist/pkg/version.js → ../../package.json
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '../../package.json'), join(here, '../package.json')];

  for (const path of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
      if (typeof pkg.version === 'string' && pkg.version.length > 0) {
        cached = pkg.version;
        return cached;
      }
    } catch {
      // try next candidate
    }
  }

  cached = process.env['npm_package_version'] ?? '0.0.0';
  return cached;
}

/** 例如 `PaCode v0.1.3` */
export function formatPacodeVersion(): string {
  return `PaCode v${getPackageVersion()}`;
}

/** 测试用：清空缓存 */
export function resetPackageVersionCache(): void {
  cached = undefined;
}
