/**
 * Agent DAG scheduler tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyToolIntent,
  buildDagPlan,
  resolveDagPlan,
  executeDagPlan,
  resetDagSequence,
  formatDagResults,
} from '../src/services/agent-scheduler/index.js';
import { ToolCall, ToolResult } from '../src/pkg/types.js';

describe('classifyToolIntent', () => {
  it('maps inspect, review, and test intents', () => {
    expect(classifyToolIntent('检查这个项目')).toBe('inspect_project');
    expect(classifyToolIntent('深度检查一下当前项目作为一个AI编程工具，是否合格？')).toBe(
      'review_implementation'
    );
    expect(classifyToolIntent('运行测试')).toBe('run_tests');
    expect(classifyToolIntent('hello')).toBeNull();
  });

  it('review_implementation plan includes services and glob', () => {
    const plan = buildDagPlan('review_implementation');
    expect(plan.nodes.length).toBe(19);
    expect(plan.nodes.some((n) => n.name === 'Glob')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'security_scan')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'coverage_tracked')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'arch_wire')).toBe(true);
  });
});

describe('executeDagPlan', () => {
  beforeEach(() => resetDagSequence());

  it('runs same-group nodes in parallel', async () => {
    const order: string[] = [];
    const plan = resolveDagPlan('检查项目')!;

    const execute = async (call: ToolCall): Promise<ToolResult> => {
      order.push(`start-${call.name}`);
      await Promise.resolve();
      order.push(`end-${call.name}`);
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    };

    const events = [];
    const gen = executeDagPlan(plan, execute);
    let step = await gen.next();
    while (!step.done) {
      events.push(step.value);
      step = await gen.next();
    }

    expect(events.filter((e) => e.type === 'tool_use').length).toBe(13);
    expect(order.indexOf('start-Read')).toBeLessThan(order.indexOf('end-Read'));
    expect(step.value?.length).toBe(13);
  });
});

describe('formatDagResults', () => {
  it('produces plain text for session injection', () => {
    const text = formatDagResults('inspect_project', [
      {
        tool: { id: 'd1', name: 'Read', input: { path: 'package.json' } },
        result: { content: [{ type: 'text' as const, text: '{"name":"pacode"}' }] },
      },
    ]);
    expect(text).toContain('项目检查已完成');
    expect(text).toContain('pacode');
  });

  it('uses strict header for review_implementation', () => {
    const text = formatDagResults('review_implementation', [
      {
        tool: { id: 'd2', name: 'Bash', input: { command: 'find src/services' } },
        result: { content: [{ type: 'text' as const, text: 'src/services/agent-scheduler/intents.ts' }] },
      },
    ]);
    expect(text).toContain('实现评估已完成');
    expect(text).toContain('禁止说');
  });
});
