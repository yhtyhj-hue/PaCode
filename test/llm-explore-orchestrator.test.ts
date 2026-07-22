/**
 * Gate: LLM explore orchestrator (real Subagent specs, not scripted DAG)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildLlmExploreSpecs,
  preferScriptedPrefetchDag,
  formatLlmExploreResults,
  runLlmExploreAgents,
} from '../src/services/agent-scheduler/llm-explore-orchestrator.js';
import { getSubagentManager, type SubagentResult } from '../src/agent/subagent.js';
import { getAgentPool, resetAgentPool } from '../src/services/agent-scheduler/agent-pool.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('llm-explore-orchestrator', () => {
  beforeEach(() => {
    resetAgentPool();
    delete process.env['PACODE_PREFETCH_DAG'];
  });

  it('builds 4 explore missions for inspect_project', () => {
    const specs = buildLlmExploreSpecs('inspect_project', '深度项目质检');
    expect(specs).toHaveLength(4);
    expect(specs.map((s) => s.label)).toContain('Git变更分析');
    expect(specs.every((s) => s.prompt.includes('explore subagent'))).toBe(true);
  });

  it('builds missions for code_audit / review_implementation; empty for run_tests', () => {
    expect(buildLlmExploreSpecs('run_tests', 'x')).toEqual([]);
    const audit = buildLlmExploreSpecs('code_audit', '审计');
    expect(audit.map((s) => s.label)).toContain('Agent 核心回路');
    expect(audit).toHaveLength(4);
    const review = buildLlmExploreSpecs('review_implementation', '评审');
    expect(review.map((s) => s.label)).toContain('变更审查');
    expect(review.length).toBeGreaterThanOrEqual(3);
  });

  it('formatLlmExploreResults handles failed and empty summary', () => {
    const failed: SubagentResult = {
      name: 'explore',
      success: false,
      output: '',
      toolCalls: 0,
      duration: 1,
      error: 'aborted',
      report: {
        agent: 'explore',
        success: false,
        summary: '',
        toolCalls: 0,
        durationMs: 1,
        isolation: 'none',
      },
    };
    const text = formatLlmExploreResults('code_audit', [{ label: '安全面', result: failed }]);
    expect(text).toContain('failed');
    expect(text).toContain('aborted');
  });

  it('formatLlmExploreResults marks real LLM agents', () => {
    const fake: SubagentResult = {
      name: 'explore',
      success: true,
      output: 'x',
      toolCalls: 2,
      duration: 10,
      report: {
        agent: 'explore',
        success: true,
        summary: 'found engine.ts risk',
        toolCalls: 2,
        durationMs: 10,
        isolation: 'none',
      },
    };
    const text = formatLlmExploreResults('inspect_project', [
      { label: 'Git变更分析', result: fake },
    ]);
    expect(text).toContain('real QueryEngine subagents');
    expect(text).toContain('found engine.ts risk');
  });

  it('runLlmExploreAgents yields agents_running/complete with mocked manager.run', async () => {
    const manager = getSubagentManager();
    manager.registerDefaults();
    const original = manager.run.bind(manager);
    manager.run = async (config, prompt) => {
      expect(config.mode).toBe(PermissionMode.BYPASS);
      expect(prompt).toContain('Mission');
      return {
        name: 'explore',
        success: true,
        output: 'ok',
        toolCalls: 1,
        duration: 5,
        report: {
          agent: 'explore',
          success: true,
          summary: 'ok-summary',
          toolCalls: 1,
          durationMs: 5,
          isolation: 'none',
        },
      };
    };

    const events = [];
    const gen = runLlmExploreAgents('inspect_project', {
      queryId: 'q1',
      userIntent: '深度项目质检',
      toolRegistry: new ToolRegistry(),
    });
    let results = [];
    while (true) {
      const step = await gen.next();
      if (step.done) {
        results = step.value ?? [];
        break;
      }
      events.push(step.value);
    }

    manager.run = original;
    expect(events.some((e) => e.type === 'agents_running')).toBe(true);
    expect(events.some((e) => e.type === 'agents_complete')).toBe(true);
    expect(results).toHaveLength(4);
    expect(getAgentPool().snapshot().every((a) => a.status === 'done')).toBe(true);
  });
});
