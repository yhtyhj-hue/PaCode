/**
 * M5 × Claude Code CLI runner（确定性 spawn + verify 评分）
 *
 * 与 PaCode live 共用同一 fixture / TASK.md / verify.mjs，便于并排对比。
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  M5_TASKS,
  type M5TaskId,
  gradeM5Task,
  materializeBroken,
  readTaskPrompt,
} from './m5-grader.js';
import { resolveM5LiveCredentials } from './m5-live-runner.js';

export interface M5CcRunResult {
  taskId: M5TaskId;
  passed: boolean;
  message: string;
  durationMs: number;
  exitCode: number | null;
  stdoutPreview?: string;
  stderrPreview?: string;
}

export interface M5CompareTaskRow {
  id: string;
  pacodePassed: boolean;
  ccPassed: boolean;
  pacodeDurationMs?: number;
  ccDurationMs?: number;
  pacodeMessage?: string;
  ccMessage?: string;
}

export interface M5CompareReport {
  updatedAt: string;
  threshold: number;
  pacodePassRate: number;
  ccPassRate: number;
  tasks: M5CompareTaskRow[];
  note: string;
  claudeVersion?: string;
}

/** 解析本机 claude CLI；无则 null（CI skip） */
export function resolveClaudeCli(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env['PACODE_CLAUDE_CLI']?.trim();
  if (override) return override;
  const which = spawnSync('which', ['claude'], { encoding: 'utf-8' });
  if (which.status === 0) {
    const path = which.stdout.trim();
    return path || null;
  }
  return null;
}

export function readClaudeVersion(cli: string): string | undefined {
  const r = spawnSync(cli, ['--version'], { encoding: 'utf-8', timeout: 10_000 });
  if (r.status !== 0) return undefined;
  return (r.stdout || r.stderr).trim().split('\n')[0];
}

/** 供测试：组装 spawn argv（prompt 必须在末尾，stdin 忽略） */
export function buildClaudePrintArgs(prompt: string, allowedTools?: string[]): string[] {
  const args = ['-p', '--dangerously-skip-permissions'];
  if (allowedTools && allowedTools.length > 0) {
    args.push(`--allowed-tools=${allowedTools.join(',')}`);
  }
  args.push(prompt);
  return args;
}

function preview(text: string, max = 240): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 注入 cc-switch / env 凭证，不打印密钥 */
export function buildClaudeEnv(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const resolved = resolveM5LiveCredentials();
  const next: NodeJS.ProcessEnv = { ...env };
  if (resolved.apiKey) next['ANTHROPIC_API_KEY'] = resolved.apiKey;
  if (resolved.baseUrl) next['ANTHROPIC_BASE_URL'] = resolved.baseUrl;
  if (resolved.model) next['CLAUDE_MODEL'] = resolved.model;
  return next;
}

export async function runClaudePrint(options: {
  cli: string;
  cwd: string;
  prompt: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  allowedTools?: string[];
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const args = buildClaudePrintArgs(
    options.prompt,
    options.allowedTools ?? ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep']
  );
  return new Promise((resolve) => {
    const child = spawn(options.cli, args, {
      cwd: options.cwd,
      env: options.env ?? buildClaudeEnv(),
      // 避免 Claude CLI 等 stdin 3s
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf-8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf-8');
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
      });
    });
  });
}

export async function runM5ClaudeCodeAgent(
  fixturesRoot: string,
  workRoot: string,
  options: { cli?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<M5CcRunResult[]> {
  const cli = options.cli ?? resolveClaudeCli();
  if (!cli) {
    throw new Error('claude CLI not found (set PACODE_CLAUDE_CLI or install Claude Code)');
  }
  const timeoutMs = options.timeoutMs ?? 180_000;
  const env = options.env ?? buildClaudeEnv();
  const results: M5CcRunResult[] = [];

  for (const taskId of M5_TASKS) {
    const started = Date.now();
    const fixtureRoot = join(fixturesRoot, taskId);
    const workDir = join(workRoot, taskId);
    mkdirSync(workDir, { recursive: true });
    materializeBroken(fixtureRoot, workDir);

    const prompt = [
      readTaskPrompt(fixtureRoot),
      '',
      'Working directory is already the project root.',
      'Use tools to change files — do not only describe a plan.',
      'When finished, `node verify.mjs` must pass.',
    ].join('\n');

    const run = await runClaudePrint({
      cli,
      cwd: workDir,
      prompt,
      timeoutMs,
      env,
    });
    const grade = gradeM5Task(taskId, workDir);
    results.push({
      taskId,
      passed: grade.passed,
      message: grade.passed
        ? grade.message
        : [
            grade.message.trim(),
            `exit=${run.exitCode}`,
            run.stderr ? `stderr=${preview(run.stderr)}` : '',
            run.stdout ? `stdout=${preview(run.stdout)}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
      durationMs: Date.now() - started,
      exitCode: run.exitCode,
      stdoutPreview: preview(run.stdout),
      stderrPreview: preview(run.stderr),
    });
  }
  return results;
}

/** 并排汇总（无密钥） */
export function buildM5CompareReport(options: {
  pacode: Array<{
    taskId: string;
    passed: boolean;
    durationMs?: number;
    message?: string;
  }>;
  cc: Array<{
    taskId: string;
    passed: boolean;
    durationMs?: number;
    message?: string;
  }>;
  threshold?: number;
  note: string;
  claudeVersion?: string;
}): M5CompareReport {
  const threshold = options.threshold ?? 0.5;
  const ids = M5_TASKS as string[];
  const tasks: M5CompareTaskRow[] = ids.map((id) => {
    const p = options.pacode.find((r) => r.taskId === id);
    const c = options.cc.find((r) => r.taskId === id);
    return {
      id,
      pacodePassed: Boolean(p?.passed),
      ccPassed: Boolean(c?.passed),
      pacodeDurationMs: p?.durationMs,
      ccDurationMs: c?.durationMs,
      pacodeMessage: p?.message?.slice(0, 200),
      ccMessage: c?.message?.slice(0, 200),
    };
  });
  const pacodePassRate =
    tasks.length === 0 ? 1 : tasks.filter((t) => t.pacodePassed).length / tasks.length;
  const ccPassRate =
    tasks.length === 0 ? 1 : tasks.filter((t) => t.ccPassed).length / tasks.length;
  return {
    updatedAt: new Date().toISOString(),
    threshold,
    pacodePassRate,
    ccPassRate,
    tasks,
    note: options.note,
    claudeVersion: options.claudeVersion,
  };
}

export function writeM5CompareReport(outPath: string, report: M5CompareReport): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
}
