/**
 * Gate eval: M5 工程任务 fixture 契约 + grader评分器
 *
 * M5: 「改 bug / 加测 / 小重构」一次成功率 — 本文件锁定：
 * (a) broken 起点 verify 失败
 * (b) golden 解 verify 通过（评分器真能区分成败）
 * (c) 三任务齐全
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  M5_TASKS,
  applyGolden,
  gradeM5Task,
  materializeBroken,
} from '../lib/m5-grader.js';

const FIXTURES = join(process.cwd(), 'evals/fixtures/m5');

describe('eval:gate:m5-engineering-tasks', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'm5-gate-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('defines three engineering tasks', () => {
    expect(M5_TASKS).toEqual(['fix-bug', 'add-test', 'small-refactor']);
  });

  for (const taskId of M5_TASKS) {
    it(`${taskId}: broken fails verify, golden passes`, () => {
      const root = join(FIXTURES, taskId);
      materializeBroken(root, workDir);
      const brokenGrade = gradeM5Task(taskId, workDir);
      expect(brokenGrade.passed).toBe(false);

      applyGolden(root, workDir);
      // golden 覆盖后仍需 verify.mjs（materialize 已放）
      const goldenGrade = gradeM5Task(taskId, workDir);
      expect(goldenGrade.passed).toBe(true);
    });
  }
});
