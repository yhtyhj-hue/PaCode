/**
 * Tool intent detection tests
 */

import { describe, it, expect } from 'vitest';
import { requiresToolExecution, getLatestUserText } from '../src/agent/tool-intent.js';

describe('requiresToolExecution', () => {
  it('matches analysis and inspection phrases', () => {
    expect(requiresToolExecution('分析这个项目')).toBe(true);
    expect(requiresToolExecution('检查当前项目')).toBe(true);
    expect(requiresToolExecution('检查项目')).toBe(true);
    expect(requiresToolExecution('check the project')).toBe(true);
    expect(requiresToolExecution('analyze the codebase')).toBe(true);
    expect(requiresToolExecution('运行测试')).toBe(true);
  });

  // 中文变体：之前"做一次深度项目质检"不匹配，导致模型走 model-driven 路径
  // 只承诺不调工具。现在应触发 DAG 路径。
  it('matches Chinese verb-prefixed inspection phrases', () => {
    expect(requiresToolExecution('做一次深度项目质检')).toBe(true);
    expect(requiresToolExecution('做项目质检')).toBe(true);
    expect(requiresToolExecution('进行一次项目审计')).toBe(true);
    expect(requiresToolExecution('执行代码扫描')).toBe(true);
    expect(requiresToolExecution('跑一下项目评估')).toBe(true);
  });

  it('ignores casual chat and subagent-style prompts', () => {
    expect(requiresToolExecution('你好')).toBe(false);
    expect(requiresToolExecution('thanks')).toBe(false);
    expect(requiresToolExecution('explore codebase')).toBe(false);
    expect(requiresToolExecution('现在可以了?')).toBe(false);
  });
});

describe('getLatestUserText', () => {
  it('returns latest user string message', () => {
    const text = getLatestUserText([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'second' },
    ]);
    expect(text).toBe('second');
  });
});
