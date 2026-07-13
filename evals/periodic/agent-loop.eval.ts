/**
 * Periodic eval: Agent 循环质量（需 ANTHROPIC_API_KEY）
 *
 * 骨架：无 API key 时 skip；有 key 时跑 mock 路径验证 harness 接线。
 * 后续可替换为真实 LLM 调用 + 评分 rubric。
 */
import { describe, it, expect } from 'vitest';
import { meetsThreshold } from '../lib/types.js';

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
const PASS_THRESHOLD = 0.8;

describe.skipIf(!hasApiKey)('eval:periodic:agent-loop', () => {
  it('placeholder quality check meets threshold', async () => {
    // 骨架：真实 periodic eval 在此调用 QueryEngine + rubric 评分
    const score = 1;
    expect(meetsThreshold(score, PASS_THRESHOLD)).toBe(true);
  });
});

describe('eval:periodic:agent-loop (offline)', () => {
  it('harness skips LLM evals when ANTHROPIC_API_KEY unset', () => {
    if (hasApiKey) return;
    expect(hasApiKey).toBe(false);
  });
});
