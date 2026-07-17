/**
 * I3: Reflection bound to evidence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectVerifiers,
  runVerifier,
  runReflection,
  hasCodeMutatingToolCall,
  MAX_REFLECTIONS_PER_QUERY,
} from '../src/agent/reflection.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'pacode-i3-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('I3 detectVerifiers', () => {
  it('detects npm test for a package.json with a real test script', () => {
    writeFileSync(
      join(workDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint src' } })
    );
    const v = detectVerifiers(workDir);
    const test = v.find((x) => x.kind === 'test');
    expect(test?.available).toBe(true);
    expect(test?.command).toBe('npm');
    const lint = v.find((x) => x.kind === 'lint');
    expect(lint?.available).toBe(true);
  });

  it('marks unavailable when package.json has only the default echo test', () => {
    writeFileSync(
      join(workDir, 'package.json'),
      JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      })
    );
    const v = detectVerifiers(workDir);
    const test = v.find((x) => x.kind === 'test');
    expect(test?.available).toBe(false);
    expect(test?.reason).toContain('no real test script');
  });

  it('detects cargo for Cargo.toml projects', () => {
    writeFileSync(join(workDir, 'Cargo.toml'), '[package]\nname = "x"');
    const v = detectVerifiers(workDir);
    expect(v.some((x) => x.kind === 'test' && x.command === 'cargo')).toBe(true);
  });

  it('detects go for go.mod projects', () => {
    writeFileSync(join(workDir, 'go.mod'), 'module x');
    const v = detectVerifiers(workDir);
    expect(v.some((x) => x.kind === 'test' && x.command === 'go')).toBe(true);
  });

  it('detects pytest for pyproject.toml projects', () => {
    writeFileSync(join(workDir, 'pyproject.toml'), '[project]\nname = "x"');
    const v = detectVerifiers(workDir);
    expect(v.some((x) => x.kind === 'test' && x.command === 'pytest')).toBe(true);
  });

  it('marks unavailable for an unknown project', () => {
    const v = detectVerifiers(workDir);
    const test = v.find((x) => x.kind === 'test');
    expect(test?.available).toBe(false);
    expect(test?.reason).toContain('no recognized project manifest');
  });
});

describe('I3 hasCodeMutatingToolCall', () => {
  it('returns true when Edit/Write/NotebookEdit is in the history', () => {
    expect(hasCodeMutatingToolCall([{ name: 'Edit' }])).toBe(true);
    expect(hasCodeMutatingToolCall([{ name: 'Read' }, { name: 'Write' }])).toBe(true);
    expect(hasCodeMutatingToolCall([{ name: 'Bash' }, { name: 'NotebookEdit' }])).toBe(true);
  });
  it('returns false when no code-mutating tool is in the history', () => {
    expect(hasCodeMutatingToolCall([{ name: 'Read' }, { name: 'Bash' }])).toBe(false);
    expect(hasCodeMutatingToolCall([])).toBe(false);
  });
});

describe('I3 runReflection integration', () => {
  it('runs the npm test verifier and reports failure on exit=1', async () => {
    // Set up a project whose `test` script exits 1
    writeFileSync(
      join(workDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } })
    );
    const summary = await runReflection(workDir);
    expect(summary.ran).toBeGreaterThan(0);
    expect(summary.failed).toBeGreaterThan(0);
    expect(summary.failureMessage).toContain('[I3 Reflection] verification failed');
    expect(summary.failureMessage).toContain('exit=1');
  });

  it('returns no failureMessage when verifier passes', async () => {
    writeFileSync(
      join(workDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } })
    );
    const summary = await runReflection(workDir);
    expect(summary.failed).toBe(0);
    expect(summary.failureMessage).toBe('');
  });

  it('returns failureMessage="" and skipNotice when no project manifest', async () => {
    // No project manifest -> detectVerifiers returns a single
    // 'test' verifier with available=false. Soft skipNotice warns
    // the model not to claim tests passed.
    const summary = await runReflection(workDir);
    expect(summary.failed).toBe(0);
    expect(summary.failureMessage).toBe('');
    expect(summary.skipNotice).toMatch(/Do not claim tests/);
  });
});

describe('I3 MAX_REFLECTIONS_PER_QUERY cap', () => {
  it('is in (0, 5] to prevent infinite loops', () => {
    expect(MAX_REFLECTIONS_PER_QUERY).toBeGreaterThan(0);
    expect(MAX_REFLECTIONS_PER_QUERY).toBeLessThanOrEqual(5);
  });
});