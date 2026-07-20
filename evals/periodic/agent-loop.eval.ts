/**
 * Periodic eval: M1 — 与 gate m1-engine-behavior 同源 runner
 *
 * `npm test` 排除 periodic；本文件供 `npm run eval:periodic` 复跑。
 * 无硬编码 score=1。
 */

import { describe, it, expect } from 'vitest';
import { meetsThreshold } from '../lib/types.js';
import {
  runM1EvidenceCase,
  runM1FakeCompletionCase,
  scoreM1Suite,
} from '../lib/m1-runner.js';

describe('eval:periodic:agent-loop / M1', () => {
  it('fake completion and evidence cases both pass', async () => {
    const results = await Promise.all([
      runM1FakeCompletionCase(),
      runM1EvidenceCase(),
    ]);
    for (const r of results) {
      expect(r.passed, r.detail).toBe(true);
    }
    expect(meetsThreshold(scoreM1Suite(results), 1)).toBe(true);
  });
});
