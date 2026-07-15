/**
 * 并行 Agent 编排 — 将 inspect/review 拆成 4 路并行 DAG worker（对齐 CC 多 agent UI）
 */

import { QueryEvent, ToolCall, ToolResult } from '../../pkg/types.js';
import { DagExecuteFn } from './executor.js';
import { DagNodeSpec, ToolIntent } from './types.js';
import {
  GIT_DIFF_NAMES,
  GIT_DIFF_STAT,
  GIT_LOG_ONELINE,
  GIT_STATUS,
  SECURITY_DIFF_SCAN,
  NPM_TEST_SUMMARY_CMD,
  CI_CHECK_CMD,
  COVERAGE_TRACKED_CMD,
  ARCH_WIRE_CMD,
} from './git-context.js';
import { getAgentPool } from './agent-pool.js';

export type PrefetchRun = { tool: ToolCall; result: ToolResult };

export interface ParallelAgentTask {
  id: string;
  label: string;
  agentType: 'explore' | 'general-purpose';
  nodes: DagNodeSpec[];
}

const SERVICES_TREE_CMD =
  'find src/services -type f 2>/dev/null | head -40 || echo "(no src/services files)"';
const CONTRACTS_CMD =
  'test -d contracts && find contracts -type f 2>/dev/null | head -20 || echo "contracts/ missing"';
const TEST_STATS_CMD = 'find test -name "*.test.ts" 2>/dev/null | wc -l | tr -d " "';

/** 是否对 inspect/review/code_audit 启用并行 agent（默认开） */
export function isParallelAgentsEnabled(): boolean {
  return process.env['PACODE_PARALLEL_AGENTS'] !== '0';
}

export function buildParallelAgentTasks(intent: ToolIntent): ParallelAgentTask[] {
  if (intent === 'run_tests') return [];

  if (intent === 'code_audit') {
    return [
      {
        id: 'agent-engine',
        label: 'Agent 核心回路',
        agentType: 'explore',
        nodes: [
          {
            id: 'read_engine',
            name: 'Read',
            input: { path: 'src/agent/engine.ts', limit: 150 },
            group: 0,
          },
          {
            id: 'read_model_stream',
            name: 'Read',
            input: { path: 'src/agent/model-stream.ts', limit: 100 },
            group: 0,
          },
        ],
      },
      {
        id: 'agent-tools',
        label: '工具层实现',
        agentType: 'explore',
        nodes: [
          {
            id: 'read_bash_secure',
            name: 'Read',
            input: { path: 'src/tools/bash-secure.ts', limit: 100 },
            group: 0,
          },
          {
            id: 'read_task',
            name: 'Read',
            input: { path: 'src/tools/task.ts', limit: 80 },
            group: 0,
          },
        ],
      },
      {
        id: 'agent-perm',
        label: '权限系统',
        agentType: 'explore',
        nodes: [
          {
            id: 'read_permission',
            name: 'Read',
            input: { path: 'src/permission/system.ts', limit: 100 },
            group: 0,
          },
          {
            id: 'read_classifier',
            name: 'Read',
            input: { path: 'src/permission/classifier.ts', limit: 80 },
            group: 0,
          },
        ],
      },
      {
        id: 'agent-tests',
        label: '测试覆盖',
        agentType: 'explore',
        nodes: [
          {
            id: 'read_engine_query_test',
            name: 'Read',
            input: { path: 'test/engine-query.test.ts', limit: 100 },
            group: 0,
          },
          {
            id: 'read_e2e',
            name: 'Read',
            input: { path: 'test/e2e/agent-happy-path.test.ts', limit: 80 },
            group: 0,
          },
        ],
      },
    ];
  }

  const gitNodes: DagNodeSpec[] = [
    { id: 'git_status', name: 'Bash', input: { command: GIT_STATUS }, group: 0 },
    { id: 'git_diff_stat', name: 'Bash', input: { command: GIT_DIFF_STAT }, group: 0 },
    { id: 'git_log', name: 'Bash', input: { command: GIT_LOG_ONELINE }, group: 0 },
    { id: 'git_diff_names', name: 'Bash', input: { command: GIT_DIFF_NAMES }, group: 0 },
  ];

  const docsNodes: DagNodeSpec[] = [
    { id: 'read_pkg', name: 'Read', input: { path: 'package.json' }, group: 0 },
    { id: 'read_readme', name: 'Read', input: { path: 'README.md' }, group: 0 },
    { id: 'read_claude', name: 'Read', input: { path: 'CLAUDE.md' }, group: 0 },
  ];

  const structureNodes: DagNodeSpec[] = [
    { id: 'glob_src', name: 'Glob', input: { pattern: 'src/**/*.ts' }, group: 0 },
    {
      id: 'services_tree',
      name: 'Bash',
      input: { command: SERVICES_TREE_CMD },
      group: 0,
    },
    {
      id: 'contracts_check',
      name: 'Bash',
      input: { command: CONTRACTS_CMD },
      group: 0,
    },
  ];

  const tasks: ParallelAgentTask[] = [
    {
      id: 'agent-git',
      label: 'Git变更分析',
      agentType: 'explore',
      nodes: gitNodes,
    },
    {
      id: 'agent-docs',
      label: '项目配置审查',
      agentType: 'explore',
      nodes: docsNodes,
    },
    {
      id: 'agent-structure',
      label: '代码结构扫描',
      agentType: 'explore',
      nodes: structureNodes,
    },
  ];

  if (intent === 'review_implementation') {
    tasks.push({
      id: 'agent-security',
      label: '安全风险扫描',
      agentType: 'general-purpose',
      nodes: [
        {
          id: 'security_scan',
          name: 'Bash',
          input: { command: SECURITY_DIFF_SCAN },
          group: 0,
        },
        {
          id: 'test_stats',
          name: 'Bash',
          input: { command: TEST_STATS_CMD },
          group: 0,
        },
        {
          id: 'npm_test_summary',
          name: 'Bash',
          input: { command: NPM_TEST_SUMMARY_CMD },
          group: 0,
        },
        {
          id: 'ci_check',
          name: 'Bash',
          input: { command: CI_CHECK_CMD },
          group: 0,
        },
        {
          id: 'coverage_tracked',
          name: 'Bash',
          input: { command: COVERAGE_TRACKED_CMD },
          group: 0,
        },
        {
          id: 'arch_wire',
          name: 'Bash',
          input: { command: ARCH_WIRE_CMD },
          group: 0,
        },
      ],
    });
  } else {
    tasks.push({
      id: 'agent-quality',
      label: '测试与质量',
      agentType: 'explore',
      nodes: [
        {
          id: 'test_stats',
          name: 'Bash',
          input: { command: TEST_STATS_CMD },
          group: 0,
        },
        {
          id: 'npm_test_summary',
          name: 'Bash',
          input: { command: NPM_TEST_SUMMARY_CMD },
          group: 0,
        },
        {
          id: 'ci_check',
          name: 'Bash',
          input: { command: CI_CHECK_CMD },
          group: 0,
        },
        {
          id: 'coverage_tracked',
          name: 'Bash',
          input: { command: COVERAGE_TRACKED_CMD },
          group: 0,
        },
        {
          id: 'arch_wire',
          name: 'Bash',
          input: { command: ARCH_WIRE_CMD },
          group: 0,
        },
      ],
    });
  }

  return tasks;
}

function formatToolLabel(tool: ToolCall): string {
  const arg = Object.entries(tool.input)
    .map(([k, v]) => {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}=${val.length > 36 ? val.slice(0, 33) + '...' : val}`;
    })
    .join(' ');
  return `${tool.name}(${arg})`;
}

function toToolCall(node: DagNodeSpec, seq: number): ToolCall {
  return {
    id: `dag_${node.id}_${seq}`,
    name: node.name,
    input: node.input,
  };
}

/** 4 路并行 agent 执行，实时 yield 进度事件 */
export async function* runParallelAgentPrefetch(
  intent: ToolIntent,
  execute: DagExecuteFn,
  queryId: string
): AsyncGenerator<QueryEvent, PrefetchRun[], unknown> {
  const tasks = buildParallelAgentTasks(intent);
  if (tasks.length === 0) return [];

  const pool = getAgentPool();
  pool.beginQuery(
    queryId,
    tasks.map((t) => ({ id: t.id, label: t.label, agentType: t.agentType }))
  );

  yield {
    type: 'agents_running',
    parallelAgents: pool.snapshot(),
  };

  const eventQueue: QueryEvent[] = [];
  let seq = 0;
  const allRuns: PrefetchRun[] = [];

  const runOneAgent = async (task: ParallelAgentTask): Promise<void> => {
    pool.markRunning(task.id);
    eventQueue.push({
      type: 'agent_started',
      agentId: task.id,
      agentLabel: task.label,
      parallelAgents: pool.snapshot(),
    });

    try {
      for (const node of task.nodes) {
        seq += 1;
        const call = toToolCall(node, seq);
        const toolLabel = formatToolLabel(call);
        pool.recordTool(task.id, toolLabel);

        eventQueue.push({
          type: 'agent_progress',
          agentId: task.id,
          agentLabel: task.label,
          tool: call,
          parallelAgents: pool.snapshot(),
        });

        const result = await execute(call);
        allRuns.push({ tool: call, result });

        eventQueue.push({
          type: 'prefetch_progress',
          tool: call,
          result,
          prefetchDone: allRuns.length,
          prefetchTotal: tasks.reduce((n, t) => n + t.nodes.length, 0),
        });
      }
      pool.markDone(task.id);
      eventQueue.push({
        type: 'agent_complete',
        agentId: task.id,
        agentLabel: task.label,
        parallelAgents: pool.snapshot(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pool.markError(task.id, msg);
      eventQueue.push({
        type: 'agent_complete',
        agentId: task.id,
        agentLabel: task.label,
        parallelAgents: pool.snapshot(),
        error: { code: 'AGENT_ERROR', message: msg },
      });
    }
  };

  const agentPromises = tasks.map((t) => runOneAgent(t));
  let allFinished = false;
  void Promise.all(agentPromises).then(() => {
    allFinished = true;
  });

  while (!allFinished || eventQueue.length > 0) {
    while (eventQueue.length > 0) {
      yield eventQueue.shift()!;
    }
    if (allFinished) break;
    await new Promise((r) => setTimeout(r, 25));
  }

  await Promise.all(agentPromises);

  yield {
    type: 'agents_complete',
    parallelAgents: pool.snapshot(),
  };

  return allRuns;
}
