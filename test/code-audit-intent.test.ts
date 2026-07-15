/**
 * Continuation + code audit intent tests
 */

import { describe, it, expect } from 'vitest';
import {
  resolveDagPlanWithHistory,
  sessionNeedsCodeAudit,
  classifyToolIntent,
} from '../src/services/agent-scheduler/intents.js';

describe('code_audit intent', () => {
  it('matches direct code read requests', () => {
    expect(classifyToolIntent('读一下代码实现')).toBe('code_audit');
    expect(classifyToolIntent('读源文件')).toBe('code_audit');
  });

  it('continues with code audit after qualification context', () => {
    const history = [
      { role: 'user', content: '深度检查项目作为AI编程工具是否合格？' },
      { role: 'assistant', content: '基于文档的评估…' },
      { role: 'user', content: '继续啊' },
    ];
    expect(sessionNeedsCodeAudit(history)).toBe(true);
    const plan = resolveDagPlanWithHistory('继续啊', history);
    expect(plan?.intent).toBe('code_audit');
  });

  it('continues after critique to read source not docs', () => {
    const history = [
      { role: 'user', content: '深度检查一下当前项目作为一个AI编程工具，是否合格？' },
      { role: 'assistant', content: '文档级评估' },
      {
        role: 'user',
        content: '我让你自检是要去看完整的代码实现，不是看文档说明',
      },
      { role: 'assistant', content: '你说得对，让我读关键源文件' },
      { role: 'user', content: '继续啊' },
    ];
    expect(sessionNeedsCodeAudit(history)).toBe(true);
    expect(resolveDagPlanWithHistory('继续啊', history)?.intent).toBe('code_audit');
  });

  it('matches bare 继续 as continuation', () => {
    const history = [
      { role: 'user', content: '检查项目实现' },
      { role: 'assistant', content: '…' },
      { role: 'user', content: '继续' },
    ];
    expect(resolveDagPlanWithHistory('继续', history)?.intent).toBe('code_audit');
  });

  it('does not code-audit generic continue', () => {
    const history = [{ role: 'user', content: '你好' }, { role: 'user', content: '继续啊' }];
    expect(resolveDagPlanWithHistory('继续啊', history)).toBeNull();
  });

  it('does not code-audit continue after unrelated coding task', () => {
    const history = [
      { role: 'user', content: '深度检查项目作为AI编程工具是否合格？' },
      { role: 'assistant', content: '合格度评估…' },
      { role: 'user', content: '帮我在 src/foo.ts 写一个 helper' },
      { role: 'assistant', content: '已添加 helper 函数' },
      { role: 'user', content: '继续啊' },
    ];
    expect(sessionNeedsCodeAudit(history)).toBe(false);
    expect(resolveDagPlanWithHistory('继续啊', history)).toBeNull();
  });

  it('ignores prefetch injection blocks when judging continue context', () => {
    const history = [
      { role: 'user', content: '帮写测试' },
      { role: 'assistant', content: '好的' },
      {
        role: 'user',
        content: '[实现评估已完成。4 路并行 agent 已执行…]\n\n### Read(path="package.json")',
      },
      { role: 'user', content: '继续啊' },
    ];
    expect(sessionNeedsCodeAudit(history)).toBe(false);
  });

  it('skips shallow DAG for line-by-line deep read requests', () => {
    expect(classifyToolIntent('我需要深度质检，完整读取每一行代码')).toBeNull();
    expect(
      resolveDagPlanWithHistory('我需要的是深度质检，就是完整的读取每一行代码！', [])
    ).toBeNull();
  });

  it('does not re-prefetch code_audit after audit block already injected', () => {
    const history = [
      { role: 'user', content: '读一下代码实现' },
      {
        role: 'user',
        content: '[代码审计已完成。并行预读已注入。]\n\n### Read(path="src/agent/engine.ts")',
      },
      { role: 'assistant', content: '已开始读 engine.ts' },
      { role: 'user', content: '继续' },
    ];
    expect(sessionNeedsCodeAudit(history)).toBe(true);
    expect(resolveDagPlanWithHistory('继续', history)).toBeNull();
  });

  it('does not prefetch when continue follows an explicit full deep-read ask', () => {
    const history = [
      { role: 'user', content: '系统化深读全部核心代码，读每一行' },
      { role: 'assistant', content: '我开始系统化深读' },
      { role: 'user', content: '继续' },
    ];
    expect(resolveDagPlanWithHistory('继续', history)).toBeNull();
  });
});
