/**
 * M5 工程任务确定性评分器（无 LLM）
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export type M5TaskId = 'fix-bug' | 'add-test' | 'small-refactor';
export type M5HardTaskId = 'multi-file-bug' | 'fail-then-fix' | 'cross-module';

export interface M5GradeResult {
  taskId: string;
  passed: boolean;
  message: string;
}

function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) {
      copyTree(from, to);
    } else {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
}

/** 运行 fixture 内的 verify 脚本；exit 0 = 通过 */
export function runFixtureVerify(cwd: string): { ok: boolean; output: string } {
  const script = join(cwd, 'verify.mjs');
  if (!existsSync(script)) {
    return { ok: false, output: 'verify.mjs missing' };
  }
  try {
    const output = execFileSync(process.execPath, [script], {
      cwd,
      encoding: 'utf-8',
      timeout: 15_000,
    });
    return { ok: true, output };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: `${err.stdout ?? ''}${err.stderr ?? err.message ?? String(e)}`,
    };
  }
}

export function gradeM5Task(taskId: string, cwd: string): M5GradeResult {
  const result = runFixtureVerify(cwd);
  return {
    taskId,
    passed: result.ok,
    message: result.ok ? 'verify passed' : result.output.slice(0, 500),
  };
}

/** 将 golden 覆盖到工作区（gate 自测用） */
export function applyGolden(fixtureRoot: string, workDir: string): void {
  const goldenDir = join(fixtureRoot, 'golden');
  if (!existsSync(goldenDir)) {
    throw new Error(`golden missing: ${goldenDir}`);
  }
  copyTree(goldenDir, workDir);
}

export function readTaskPrompt(fixtureRoot: string): string {
  const p = join(fixtureRoot, 'TASK.md');
  return existsSync(p) ? readFileSync(p, 'utf-8') : `Complete the engineering task in ${fixtureRoot}`;
}

/** 准备干净工作副本（broken 起点） */
export function materializeBroken(fixtureRoot: string, workDir: string): void {
  const broken = join(fixtureRoot, 'broken');
  if (!existsSync(broken)) {
    throw new Error(`broken missing: ${broken}`);
  }
  copyTree(broken, workDir);
  const verify = join(fixtureRoot, 'verify.mjs');
  if (existsSync(verify)) {
    writeFileSync(join(workDir, 'verify.mjs'), readFileSync(verify));
  }
}

export const M5_TASKS: M5TaskId[] = ['fix-bug', 'add-test', 'small-refactor'];

export const M5_HARD_TASKS: M5HardTaskId[] = [
  'multi-file-bug',
  'fail-then-fix',
  'cross-module',
];
