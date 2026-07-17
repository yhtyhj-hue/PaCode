/**
 * LLM Explore 编排 — 真 Subagent（QueryEngine），非脚本 DAG
 *
 * 默认用于 inspect_project / review_implementation / code_audit。
 * 逃逸：PACODE_PREFETCH_DAG=1 仍走 parallel-orchestrator 脚本路径。
 */

import { QueryEvent, PermissionMode } from '../../pkg/types.js';
import { getSubagentManager, type SubagentConfig, type SubagentResult } from '../../agent/subagent.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { HookRegistry } from '../../hooks/registry.js';
import type { ToolIntent } from './types.js';
import { getAgentPool } from './agent-pool.js';

export interface LlmExploreSpec {
  id: string;
  label: string;
  prompt: string;
}

export interface LlmExploreOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  toolRegistry: ToolRegistry;
  hookRegistry?: HookRegistry;
  workingDirectory?: string;
  shouldAbort?: () => boolean;
  queryId: string;
  /** 用户原始意图，注入各 agent 上下文 */
  userIntent: string;
}

/** 脚本 DAG 逃逸开关（默认关 = 真 LLM explore） */
export function preferScriptedPrefetchDag(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['PACODE_PREFETCH_DAG'] === '1';
}

export function buildLlmExploreSpecs(intent: ToolIntent, userIntent: string): LlmExploreSpec[] {
  const brief = userIntent.slice(0, 500);
  if (intent === 'run_tests') return [];

  if (intent === 'code_audit') {
    return [
      {
        id: 'explore-engine',
        label: 'Agent 核心回路',
        prompt: explorePrompt(
          brief,
          'Focus on src/agent/engine.ts and the query loop. Find real bugs, recursion risks, and permission gaps. Use Read/Grep/Glob. Cite file:line.'
        ),
      },
      {
        id: 'explore-tools',
        label: '工具与权限',
        prompt: explorePrompt(
          brief,
          'Audit src/tools and src/permission. Note Bash security, Task/Subagent nesting, and deny-first holes. Cite file:line.'
        ),
      },
      {
        id: 'explore-services',
        label: '服务边界',
        prompt: explorePrompt(
          brief,
          'Map src/services/*: shared mutable state, missing contracts/, and whether prefetch is fake vs real Subagent. Cite evidence.'
        ),
      },
      {
        id: 'explore-tests',
        label: '测试与 CI',
        prompt: explorePrompt(
          brief,
          'Check test/, package.json scripts, .github/workflows. Coverage gates, skipped tests, eval:gate vs periodic. Cite paths.'
        ),
      },
    ];
  }

  if (intent === 'review_implementation') {
    return [
      {
        id: 'explore-diff',
        label: '变更审查',
        prompt: explorePrompt(
          brief,
          'Review recent git changes (git status/diff). Flag risky mutations, missing tests, secret leaks. Use Bash/Read as needed.'
        ),
      },
      {
        id: 'explore-quality',
        label: '质量门禁',
        prompt: explorePrompt(
          brief,
          'Verify CI, lint, and test scripts exist and what they enforce. Note gaps vs claimed coverage.'
        ),
      },
      {
        id: 'explore-security',
        label: '安全面',
        prompt: explorePrompt(
          brief,
          'Look for credential handling, bash injection, path escape. Prefer evidence over speculation.'
        ),
      },
    ];
  }

  // inspect_project（深度质检）
  return [
    {
      id: 'explore-git',
      label: 'Git变更分析',
      prompt: explorePrompt(
        brief,
        'Inspect git status/diff/log. Summarize what changed and risk. Use Bash + Read. You are a real explore agent — choose tools yourself, do not follow a fixed script.'
      ),
    },
    {
      id: 'explore-config',
      label: '项目配置审查',
      prompt: explorePrompt(
        brief,
        'Read package.json, CLAUDE.md/README, CI config. Compare claimed architecture (contracts/, coverage) to reality.'
      ),
    },
    {
      id: 'explore-structure',
      label: '代码结构扫描',
      prompt: explorePrompt(
        brief,
        'Map src/ layout (agent, tools, services, permission). Note oversized modules and misleading "agent" prefetch code.'
      ),
    },
    {
      id: 'explore-quality',
      label: '测试与质量',
      prompt: explorePrompt(
        brief,
        'Survey test/ and evals/. Run `npm test` only if needed and allowed; prefer reading configs first. Report pass/fail evidence.'
      ),
    },
  ];
}

function explorePrompt(userBrief: string, mission: string): string {
  return [
    'You are an explore subagent with your own tool loop (Read/Glob/Grep/Bash).',
    'Do NOT pretend findings without tool evidence. Cite paths and line ranges when possible.',
    'Return a concise structured report: findings, risks, open questions.',
    '',
    `User request:\n${userBrief}`,
    '',
    `Mission:\n${mission}`,
  ].join('\n');
}

function exploreConfig(): SubagentConfig {
  const base = getSubagentManager().get('explore') ?? {
    name: 'explore',
    description: 'Read-only explore',
    tools: ['Read', 'Glob', 'Grep'],
  };
  // 自动扇出：BYPASS 避免嵌套权限风暴；Bash 仍受 bash-secure deny
  return {
    ...base,
    name: 'explore',
    mode: PermissionMode.BYPASS,
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    systemPrompt:
      'You explore codebases with tools. Prefer evidence. No nested Task/Subagent fan-out.',
  };
}

/** 格式化注入主会话的报告块 */
export function formatLlmExploreResults(
  intent: ToolIntent,
  results: Array<{ label: string; result: SubagentResult }>
): string {
  const lines = [
    `## LLM explore subagent reports (${intent})`,
    'These are real QueryEngine subagents (not a scripted DAG). Verify claims against tool evidence below.',
    '',
  ];
  for (const { label, result } of results) {
    lines.push(`### ${label} (${result.success ? 'ok' : 'failed'}, ${result.toolCalls} tools, ${result.duration}ms)`);
    lines.push(result.report.summary.slice(0, 6000) || result.error || '(empty)');
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 并行跑真 explore Subagent；yield UI 事件；返回结果列表
 */
export async function* runLlmExploreAgents(
  intent: ToolIntent,
  options: LlmExploreOptions
): AsyncGenerator<QueryEvent, Array<{ label: string; result: SubagentResult }>, unknown> {
  const specs = buildLlmExploreSpecs(intent, options.userIntent);
  if (specs.length === 0) return [];

  const pool = getAgentPool();
  pool.beginQuery(
    options.queryId,
    specs.map((s) => ({
      id: s.id,
      label: s.label,
      agentType: 'explore',
    }))
  );

  yield {
    type: 'agents_running',
    parallelAgents: pool.snapshot(),
  };

  const manager = getSubagentManager();
  if (manager.list().length === 0) manager.registerDefaults();
  const config = exploreConfig();

  for (const spec of specs) {
    pool.markRunning(spec.id);
  }
  yield {
    type: 'agent_progress',
    parallelAgents: pool.snapshot(),
  };

  const results = await Promise.all(
    specs.map(async (spec) => {
      const result = await manager.run(config, spec.prompt, {
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        model: options.model,
        toolRegistry: options.toolRegistry,
        hookRegistry: options.hookRegistry,
        workingDirectory: options.workingDirectory,
        isolateWorktree: false,
        shouldAbort: options.shouldAbort,
      });
      if (result.success) {
        pool.markDone(spec.id);
        const snap = pool.snapshot().find((a) => a.id === spec.id);
        if (snap) snap.toolCalls = result.toolCalls;
      } else {
        pool.markError(spec.id, result.error ?? 'failed');
      }
      return { label: spec.label, result };
    })
  );

  if (options.shouldAbort?.()) {
    yield {
      type: 'error',
      error: { code: 'ABORTED', message: 'Query interrupted' },
    };
    return results;
  }

  yield {
    type: 'agents_complete',
    parallelAgents: pool.snapshot(),
  };

  return results;
}
