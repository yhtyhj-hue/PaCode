/**
 * Gate: M1/M3 widened — multi-lang / multi-file intent + fixture tree
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requiresToolExecution } from '../../src/agent/tool-intent.js';
import { resolveDagPlan } from '../../src/services/agent-scheduler/intents.js';

const M3_FIXTURE = join(process.cwd(), 'evals/fixtures/m3-deep-read/multi-file');

describe('eval:gate:m1-m3-widened', () => {
  it('M1: multi-lang project QA requires tool evidence', () => {
    expect(requiresToolExecution('对这个含 Go/Python/TS 的 monorepo 做深度质检')).toBe(true);
    expect(requiresToolExecution('run a full project quality check across packages')).toBe(true);
  });

  it('M3: deep-read disables shallow DAG prefetch', () => {
    const plan = resolveDagPlan('请逐行读 multi-file 目录下全部源文件');
    expect(plan).toBeNull();
  });

  it('M3 fixture tree has multi-lang sources', () => {
    expect(existsSync(M3_FIXTURE)).toBe(true);
    const names = readdirSync(M3_FIXTURE);
    expect(names.some((n) => n.endsWith('.ts'))).toBe(true);
    expect(names.some((n) => n.endsWith('.py'))).toBe(true);
    expect(names.some((n) => n.endsWith('.go'))).toBe(true);
    const task = readFileSync(join(M3_FIXTURE, 'TASK.md'), 'utf-8');
    expect(task).toMatch(/逐行|完整读|full read/i);
  });
});
