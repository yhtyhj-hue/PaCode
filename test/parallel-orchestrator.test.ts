/**
 * Parallel agent orchestrator tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildParallelAgentTasks,
  runParallelAgentPrefetch,
} from '../src/services/agent-scheduler/parallel-orchestrator.js';
import { getAgentPool, resetAgentPool } from '../src/services/agent-scheduler/agent-pool.js';
import { ToolCall, ToolResult } from '../src/pkg/types.js';

describe('buildParallelAgentTasks', () => {
  it('creates 4 parallel workers for inspect_project', () => {
    const tasks = buildParallelAgentTasks('inspect_project');
    expect(tasks).toHaveLength(4);
    expect(tasks.map((t) => t.label)).toContain('Git变更分析');
    expect(tasks.map((t) => t.label)).toContain('代码结构扫描');
  });

  it('adds fact-check nodes for review quality agent', () => {
    const tasks = buildParallelAgentTasks('review_implementation');
    const security = tasks.find((t) => t.id === 'agent-security');
    expect(security?.nodes.some((n) => n.id === 'coverage_tracked')).toBe(true);
    expect(security?.nodes.some((n) => n.id === 'arch_wire')).toBe(true);
  });
});

describe('runParallelAgentPrefetch', () => {
  beforeEach(() => resetAgentPool());

  it('runs agents in parallel and yields progress events', async () => {
    const execute = async (call: ToolCall): Promise<ToolResult> => ({
      content: [{ type: 'text', text: `${call.name}-ok` }],
    });

    const events = [];
    const gen = runParallelAgentPrefetch('inspect_project', execute, 'test-q');
    let runs = [];
    while (true) {
      const step = await gen.next();
      if (step.done) {
        runs = step.value ?? [];
        break;
      }
      events.push(step.value);
    }

    expect(events.some((e) => e.type === 'agents_running')).toBe(true);
    expect(events.some((e) => e.type === 'agents_complete')).toBe(true);
    expect(runs.length).toBe(15);
    expect(getAgentPool().snapshot().every((a) => a.status === 'done')).toBe(true);
  });
});
