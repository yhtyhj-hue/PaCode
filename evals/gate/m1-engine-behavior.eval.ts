/**
 * Gate eval: M1 引擎行为（假完成 → TOOL_REQUIRED）
 *
 * 与 m1-fake-completion（policy）互补；本文件用 mock Anthropic 跑 QueryEngine。
 * 无需 API key；随 npm test / eval:gate 执行。
 */

import { describe, it, expect } from 'vitest';
import { meetsThreshold } from '../lib/types.js';
import {
  runM1EvidenceCase,
  runM1FakeCompletionCase,
  scoreM1Suite,
} from '../lib/m1-runner.js';

describe('eval:gate:m1-engine-behavior', () => {
  it('rejects fake completion without tools', async () => {
    const result = await runM1FakeCompletionCase();
    expect(result.passed, result.detail).toBe(true);
  });

  it('accepts evidence path with Read', async () => {
    const result = await runM1EvidenceCase();
    expect(result.passed, result.detail).toBe(true);
  });

  it('suite score is 1.0', async () => {
    const results = await Promise.all([
      runM1FakeCompletionCase(),
      runM1EvidenceCase(),
    ]);
    expect(meetsThreshold(scoreM1Suite(results), 1)).toBe(true);
  });
});
