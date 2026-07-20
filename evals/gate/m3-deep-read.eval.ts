/**
 * Gate eval: M3 深读 — policy + 确定性会话 harness（≥90% fixture）
 *
 * - Policy：逐行/完整读 → requiresToolExecution
 * - Harness：fixture 工具史上全文件 Read 比例（非 live 用户语料）
 */

import { describe, it, expect } from 'vitest';
import { requiresToolExecution } from '../../src/agent/tool-intent.js';
import {
  defaultM3FixtureSuite,
  isFullFileRead,
  scoreDeepReadSuite,
} from '../lib/m3-session-harness.js';

const M3_THRESHOLD = 0.9;

describe('eval:gate:m3-deep-read', () => {
  it('triggers tool execution for "deep read" intents', () => {
    expect(requiresToolExecution('逐行读这个项目')).toBe(true);
    expect(requiresToolExecution('完整读一下这个文件')).toBe(true);
    expect(requiresToolExecution('read the full source code')).toBe(true);
  });

  it('does not require tools for casual chat', () => {
    expect(requiresToolExecution('你好')).toBe(false);
    expect(requiresToolExecution('thanks')).toBe(false);
  });

  it('scores full-file Read vs shallow limit', () => {
    expect(isFullFileRead({ path: 'a.ts' }, 100)).toBe(true);
    expect(isFullFileRead({ path: 'a.ts', limit: 100, offset: 0 }, 100)).toBe(true);
    expect(isFullFileRead({ path: 'a.ts', limit: 20, offset: 0 }, 100)).toBe(false);
  });

  it('default fixture suite meets ≥90% full-read passRate', () => {
    const { passRate, scores } = scoreDeepReadSuite(defaultM3FixtureSuite());
    expect(passRate).toBeGreaterThanOrEqual(M3_THRESHOLD);
    expect(scores).toHaveLength(10);
    expect(scores.filter((s) => s.score < 1)).toHaveLength(1);
  });
});
