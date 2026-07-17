/**
 * Tool intent detection tests
 */

import { describe, it, expect } from 'vitest';
import { requiresToolExecution, requiresCodeMutation, getLatestUserText } from '../src/agent/tool-intent.js';

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

  // 对项目深度质检 / 给代码库摸清：通用 "对/向/给 + 项目 + 深度/摸清" 变体
  it('matches general "对/向/给 + project + action" patterns', () => {
    expect(requiresToolExecution('对项目深度质检')).toBe(true);
    expect(requiresToolExecution('对项目完整审查')).toBe(true);
    expect(requiresToolExecution('给代码库摸清')).toBe(true);
    expect(requiresToolExecution('对这个项目深度了解')).toBe(true);
    expect(requiresToolExecution('向代码库详细调查')).toBe(true);
  });

  it('matches 深度质检 phrasing including screenshot case', () => {
    expect(requiresToolExecution('深度质检')).toBe(true);
    expect(requiresToolExecution('给这个项目做一次深度质检')).toBe(true);
    expect(requiresToolExecution('项目质检')).toBe(true);
  });

  it('ignores casual chat and subagent-style prompts', () => {
    expect(requiresToolExecution('你好')).toBe(false);
    expect(requiresToolExecution('thanks')).toBe(false);
    expect(requiresToolExecution('explore codebase')).toBe(false);
    expect(requiresToolExecution('现在可以了?')).toBe(false);
  });

  it('matches M5 engineering intents (fix / add-test / refactor)', () => {
    expect(requiresToolExecution('Fix the bug in add.js so verify.sh passes')).toBe(true);
    expect(requiresToolExecution('修好 add.js 里的 bug，让 verify 通过')).toBe(true);
    expect(requiresToolExecution('Add a test for clamp in clamp.test.js')).toBe(true);
    expect(requiresToolExecution('新增 clamp 的单元测试')).toBe(true);
    expect(requiresToolExecution('Do a small refactor: extract formatName')).toBe(true);
    expect(requiresToolExecution('小重构：提取 formatName 函数')).toBe(true);
    expect(requiresToolExecution('两个文件都有 bug，修好 verify.mjs')).toBe(true);
    expect(requiresToolExecution('跨模块契约不一致，对齐 getUser 与 label')).toBe(true);
  });
});

describe('requiresCodeMutation', () => {
  it('matches engineering fix intents', () => {
    expect(requiresCodeMutation('修好 bug 使 verify.mjs 通过')).toBe(true);
    expect(requiresCodeMutation('跨模块契约不一致，对齐 getUser')).toBe(true);
    expect(requiresCodeMutation('你好')).toBe(false);
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
