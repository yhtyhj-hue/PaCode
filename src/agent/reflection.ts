/**
 * I3: Reflection bound to evidence.
 *
 * Triggers a verification command (npm test / cargo test / go
 * test / pytest / npm run lint) after the model ends a turn
 * with a code-mutating tool call. The verification result is
 * injected as a synthetic user message into the conversation
 * so the next turn can act on real failure evidence rather
 * than re-reading the diff.
 *
 * Design choices:
 * - No LLM in the loop (cost + determinism).
 * - Bounded retries: 2 max reflections per query, after which
 *   the loop falls through to the model's natural end_turn.
 * - Cwd-only: detect project from process.cwd() (no remote
 *   inspection) so the reflection is local and fast.
 * - Errors are always reported as `[I3 Reflection]` tool_result
 *   so the model can see the failure mode (e.g. "no test
 *   command found") and skip.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_REFLECTIONS_PER_QUERY = 2;
/** Hard cap on verification command wall time. */
export const REFLECTION_TIMEOUT_MS = 60_000;

export type ReflectionKind = 'test' | 'lint';

export interface ProjectVerifier {
  kind: ReflectionKind;
  command: string;
  args: string[];
  /** True when the project actually has the config to run this. */
  available: boolean;
  /** Why unavailable, surfaced back to the model for transparency. */
  reason?: string;
}

/** Detect what to run for the project at cwd. */
export function detectVerifiers(cwd: string = process.cwd()): ProjectVerifier[] {
  const out: ProjectVerifier[] = [];

  // Test verifier — look for a package.json script named 'test'
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
        scripts?: Record<string, string>;
      };
      const testScript = pkg.scripts?.['test'];
      if (testScript && testScript !== 'echo "Error: no test specified" && exit 1') {
        out.push({
          kind: 'test',
          command: 'npm',
          args: ['test', '--silent'],
          available: true,
        });
      } else {
        out.push({
          kind: 'test',
          command: '',
          args: [],
          available: false,
          reason: 'package.json has no real test script',
        });
      }
      const lintScript = pkg.scripts?.['lint'];
      if (lintScript) {
        out.push({
          kind: 'lint',
          command: 'npm',
          args: ['run', 'lint', '--silent'],
          available: true,
        });
      } else {
        out.push({
          kind: 'lint',
          command: '',
          args: [],
          available: false,
          reason: 'package.json has no lint script',
        });
      }
    } catch {
      out.push({
        kind: 'test',
        command: '',
        args: [],
        available: false,
        reason: 'package.json is not valid JSON',
      });
    }
  } else if (existsSync(join(cwd, 'Cargo.toml'))) {
    out.push({ kind: 'test', command: 'cargo', args: ['test', '--quiet'], available: true });
  } else if (existsSync(join(cwd, 'go.mod'))) {
    out.push({ kind: 'test', command: 'go', args: ['test', './...'], available: true });
  } else {
    // Look for a Python project
    const hasPy = ['pytest.ini', 'pyproject.toml', 'setup.py'].some((f) =>
      existsSync(join(cwd, f))
    );
    if (hasPy) {
      out.push({ kind: 'test', command: 'pytest', args: ['-q'], available: true });
    } else {
      out.push({
        kind: 'test',
        command: '',
        args: [],
        available: false,
        reason: 'no recognized project manifest (package.json/Cargo.toml/go.mod/pyproject.toml)',
      });
    }
  }

  return out;
}

export interface ReflectionResult {
  kind: ReflectionKind;
  ok: boolean;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
  /** True if no verifier was available; result fields are placeholders. */
  skipped: boolean;
  reason?: string;
}

/** Run a single verifier; return the result. */
export function runVerifier(
  verifier: ProjectVerifier,
  cwd: string = process.cwd()
): Promise<ReflectionResult> {
  if (!verifier.available) {
    return Promise.resolve({
      kind: verifier.kind,
      ok: true,
      exitCode: 0,
      stdoutTail: '',
      stderrTail: '',
      durationMs: 0,
      skipped: true,
      reason: verifier.reason ?? 'verifier unavailable',
    });
  }
  return new Promise((resolve) => {
    const start = Date.now();
    execFile(
      verifier.command,
      verifier.args,
      { cwd, timeout: REFLECTION_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = String(stdout ?? '');
        const errOut = String(stderr ?? '');
        const TAIL = 60;
        resolve({
          kind: verifier.kind,
          ok: !err,
          exitCode: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
          stdoutTail: out.length > TAIL ? '…' + out.slice(-TAIL) : out,
          stderrTail: errOut.length > TAIL ? '…' + errOut.slice(-TAIL) : errOut,
          durationMs: Date.now() - start,
          skipped: false,
        });
      }
    );
  });
}

export interface ReflectionSummary {
  ran: number;
  failed: number;
  skipped: number;
  /** Empty when no failure worth surfacing. */
  failureMessage: string;
  /**
   * Soft notice when verifiers were skipped (no real test script).
   * Injected without forcing toolChoice — model must not claim tests passed.
   */
  skipNotice: string;
}

/** Run all available verifiers and produce a single user-message-shaped
 * summary suitable for re-injection into the conversation. */
export async function runReflection(cwd: string = process.cwd()): Promise<ReflectionSummary> {
  const verifiers = detectVerifiers(cwd);
  const results = await Promise.all(verifiers.map((v) => runVerifier(v, cwd)));
  const failures = results.filter((r) => !r.ok && !r.skipped);
  const skippedResults = results.filter((r) => r.skipped);
  const skipped = skippedResults.length;

  const skipNotice =
    failures.length === 0 && skipped > 0 && skipped === results.length
      ? [
          '[I3 Reflection] verification skipped:',
          ...skippedResults.map((r) => `- ${r.kind}: ${r.reason ?? 'unavailable'}`),
          'Do not claim tests or lint passed — no verifier ran.',
        ].join('\n')
      : '';

  if (results.length === 0 || (failures.length === 0 && skipped === results.length)) {
    return { ran: results.length, failed: 0, skipped, failureMessage: '', skipNotice };
  }
  if (failures.length === 0) {
    return { ran: results.length, failed: 0, skipped, failureMessage: '', skipNotice: '' };
  }
  const lines: string[] = ['[I3 Reflection] verification failed:'];
  for (const f of failures) {
    lines.push(`--- ${f.kind} (exit=${f.exitCode}, ${f.durationMs}ms) ---`);
    if (f.stderrTail) lines.push('stderr:' + f.stderrTail);
    if (f.stdoutTail) lines.push('stdout:' + f.stdoutTail);
  }
  return {
    ran: results.length,
    failed: failures.length,
    skipped,
    failureMessage: lines.join('\n'),
    skipNotice: '',
  };
}

/** Did the model just mutate code? Used as the reflection trigger. */
export function hasCodeMutatingToolCall(
  toolCalls: ReadonlyArray<{ name: string }>
): boolean {
  return toolCalls.some(
    (t) => t.name === 'Edit' || t.name === 'Write' || t.name === 'NotebookEdit'
  );
}