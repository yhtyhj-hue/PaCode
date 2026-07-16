/**
 * K6: /doctor — 确定性健康检查（无 LLM）
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface DoctorCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface DoctorInput {
  cwd?: string;
  hasApiKey?: boolean;
  model?: string;
  mode?: string;
  mcpConnected?: number;
  mcpTools?: number;
  skillsCount?: number;
}

function isGitRepo(cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** 跑一组本地检查，供 /doctor 打印 */
export function runDoctorChecks(input: DoctorInput = {}): DoctorCheck[] {
  const cwd = resolve(input.cwd ?? process.cwd());
  const checks: DoctorCheck[] = [];

  checks.push({
    id: 'cwd',
    ok: existsSync(cwd),
    detail: cwd,
  });

  checks.push({
    id: 'git',
    ok: isGitRepo(cwd),
    detail: isGitRepo(cwd) ? 'git repository' : 'not a git repository',
  });

  const claudeMd =
    existsSync(join(cwd, 'CLAUDE.md')) || existsSync(join(cwd, '.claude', 'CLAUDE.md'));
  checks.push({
    id: 'claude_md',
    ok: claudeMd,
    detail: claudeMd ? 'CLAUDE.md present' : 'CLAUDE.md missing (run /init)',
  });

  const pkg = existsSync(join(cwd, 'package.json'));
  checks.push({
    id: 'package_json',
    ok: pkg,
    detail: pkg ? 'package.json present' : 'no package.json',
  });

  checks.push({
    id: 'api_key',
    ok: !!input.hasApiKey,
    detail: input.hasApiKey ? 'API key configured' : 'API key missing (set via env or /providers)',
  });

  checks.push({
    id: 'model',
    ok: !!input.model,
    detail: input.model ? `model=${input.model}` : 'model unset',
  });

  if (input.mode) {
    checks.push({
      id: 'mode',
      ok: true,
      detail: `permission mode=${input.mode}`,
    });
  }

  const mcpConnected = input.mcpConnected ?? 0;
  const mcpTools = input.mcpTools ?? 0;
  checks.push({
    id: 'mcp',
    ok: true,
    detail: `${mcpConnected} server(s), ${mcpTools} tool(s)`,
  });

  const skills = input.skillsCount ?? 0;
  checks.push({
    id: 'skills',
    ok: skills > 0,
    detail: skills > 0 ? `${skills} skill(s) indexed` : 'no skills indexed',
  });

  return checks;
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  const lines = ['PaCode doctor', ''];
  let pass = 0;
  for (const c of checks) {
    const mark = c.ok ? '✓' : '✗';
    if (c.ok) pass += 1;
    lines.push(`${mark} ${c.id}: ${c.detail}`);
  }
  lines.push('');
  lines.push(`${pass}/${checks.length} checks ok`);
  return lines.join('\n');
}
