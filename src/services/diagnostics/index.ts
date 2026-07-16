/**
 * K4: 诊断收集 — 无 language server；走 tsc / eslint CLI
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: 'tsc' | 'eslint' | 'skip';
}

export interface DiagnosticsResult {
  cwd: string;
  engine: 'tsc' | 'eslint' | 'none';
  diagnostics: Diagnostic[];
  skipped?: string;
}

function hasTsProject(cwd: string): boolean {
  return (
    existsSync(join(cwd, 'tsconfig.json')) ||
    existsSync(join(cwd, 'jsconfig.json'))
  );
}

function hasEslint(cwd: string): boolean {
  return (
    existsSync(join(cwd, 'eslint.config.js')) ||
    existsSync(join(cwd, 'eslint.config.mjs')) ||
    existsSync(join(cwd, '.eslintrc.js')) ||
    existsSync(join(cwd, '.eslintrc.cjs')) ||
    existsSync(join(cwd, '.eslintrc.json'))
  );
}

/** 解析 tsc pretty=false 默认行：path(line,col): error TS1234: msg */
export function parseTscOutput(stdout: string, cwd: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const re = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:\s*(.+)$/;
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(re);
    if (!m) continue;
    out.push({
      file: resolve(cwd, m[1]!),
      line: Number(m[2]),
      col: Number(m[3]),
      severity: m[4] === 'warning' ? 'warning' : 'error',
      message: m[5]!.trim(),
      source: 'tsc',
    });
  }
  return out;
}

export async function collectDiagnostics(
  cwd: string = process.cwd(),
  options: { prefer?: 'tsc' | 'eslint'; timeoutMs?: number } = {}
): Promise<DiagnosticsResult> {
  const root = resolve(cwd);
  const timeout = options.timeoutMs ?? 60_000;

  const tryTsc = options.prefer !== 'eslint' && hasTsProject(root);
  if (tryTsc) {
    try {
      const { stdout, stderr } = await execFileAsync(
        'npx',
        ['--no-install', 'tsc', '--noEmit', '--pretty', 'false'],
        { cwd: root, timeout, maxBuffer: 8 * 1024 * 1024 }
      ).catch((err: { stdout?: string; stderr?: string; message?: string }) => ({
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? '',
      }));
      const text = `${stdout}\n${stderr}`;
      return {
        cwd: root,
        engine: 'tsc',
        diagnostics: parseTscOutput(text, root),
      };
    } catch (e) {
      return {
        cwd: root,
        engine: 'tsc',
        diagnostics: [],
        skipped: e instanceof Error ? e.message : String(e),
      };
    }
  }

  if (hasEslint(root) || options.prefer === 'eslint') {
    try {
      const { stdout } = await execFileAsync(
        'npx',
        ['--no-install', 'eslint', '.', '--format', 'json', '--max-warnings', '99999'],
        { cwd: root, timeout, maxBuffer: 8 * 1024 * 1024 }
      ).catch((err: { stdout?: string }) => ({ stdout: err.stdout ?? '[]' }));
      const parsed = JSON.parse(stdout || '[]') as Array<{
        filePath: string;
        messages: Array<{
          line?: number;
          column?: number;
          severity: number;
          message: string;
        }>;
      }>;
      const diagnostics: Diagnostic[] = [];
      for (const file of parsed) {
        for (const msg of file.messages ?? []) {
          diagnostics.push({
            file: file.filePath,
            line: msg.line ?? 1,
            col: msg.column ?? 1,
            severity: msg.severity >= 2 ? 'error' : 'warning',
            message: msg.message,
            source: 'eslint',
          });
        }
      }
      return { cwd: root, engine: 'eslint', diagnostics };
    } catch (e) {
      return {
        cwd: root,
        engine: 'eslint',
        diagnostics: [],
        skipped: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return {
    cwd: root,
    engine: 'none',
    diagnostics: [],
    skipped:
      'No tsconfig.json / eslint config found. Add one, or use Bash to run your linter.',
  };
}
