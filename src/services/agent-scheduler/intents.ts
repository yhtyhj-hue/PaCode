/**
 * 意图 → DAG 模板 + 会话上下文解析
 */

import { requiresToolExecution } from '../../agent/tool-intent.js';
import { DagNodeSpec, DagPlan, ToolIntent } from './types.js';
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

const RUN_TESTS_PATTERN =
  /(?:运行|跑|执行).{0,8}(?:测试|test|构建|build)|run\s+(?:the\s+)?tests?|npm\s+(?:test|run\s+test)/i;

const REVIEW_IMPLEMENTATION_PATTERN =
  /(?:实现情况|实现状态|实现程度|可以优化|哪里可以优化|如何优化|哪些地方|optimi[sz]e|implementation\s+status|what\s+(?:to|can)\s+(?:improve|optimize)|合格|达标|qualification|AI\s*编程工具|programming\s+tool)/i;

const CODE_AUDIT_PATTERN =
  /(?:读|看|审查).{0,10}(?:代码|源文件|源码)|(?:检查|读).{0,6}代码实现|完整代码|源文件|source\s+code|read\s+(?:the\s+)?(?:code|source|implementation)/i;

const CONTINUE_PATTERN =
  /^(?:继续|接着|往下|go\s+on|continue)(?:读|看|查|做|来)?(?:啊|呀|吧)?[.!]?$/i;

/** 要求逐行/全文深读 — 跳过浅层 prefetch DAG，交给模型真调 Read */
const DEEP_FULL_READ_PATTERN =
  /每一行|逐行|完整的?读取|深读全部|系统化深读|读完所有|全部源码/i;

function historyHasPrefetchIntent(
  history: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
  marker: string
): boolean {
  return history.some((m) => extractMessageText(m.content).includes(marker));
}

const TEST_STATS_CMD = 'find test -name "*.test.ts" 2>/dev/null | wc -l | tr -d " "';
const SERVICES_TREE_CMD =
  'find src/services -type f 2>/dev/null | head -40 || echo "(no src/services files)"';
const CONTRACTS_CMD =
  'test -d contracts && find contracts -type f 2>/dev/null | head -20 || echo "contracts/ missing"';

/** 核心源文件 — 自检必须读实现，不能只看 README */
const CORE_SOURCE_READS: DagNodeSpec[] = [
  { id: 'read_engine', name: 'Read', input: { path: 'src/agent/engine.ts', limit: 150 }, group: 0 },
  {
    id: 'read_bash_secure',
    name: 'Read',
    input: { path: 'src/tools/bash-secure.ts', limit: 100 },
    group: 0,
  },
  {
    id: 'read_permission',
    name: 'Read',
    input: { path: 'src/permission/system.ts', limit: 100 },
    group: 0,
  },
];

export function classifyToolIntent(message: string): ToolIntent | null {
  const trimmed = message.trim();
  // 完整逐行深读：不走 code_audit DAG（带 limit 片段 + 禁工具），交给模型真调 Read
  if (DEEP_FULL_READ_PATTERN.test(trimmed)) return null;
  if (!requiresToolExecution(trimmed) && !CODE_AUDIT_PATTERN.test(trimmed)) return null;
  if (RUN_TESTS_PATTERN.test(trimmed)) return 'run_tests';
  // review 优先于 code_audit，避免「检查项目实现情况」误命中源码审计
  if (REVIEW_IMPLEMENTATION_PATTERN.test(trimmed)) return 'review_implementation';
  if (CODE_AUDIT_PATTERN.test(trimmed)) return 'code_audit';
  return 'inspect_project';
}

function extractMessageText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('\n');
}

/** L1 预取注入块 — 不计入续跑上下文（避免历史预取块误触发 code_audit） */
const PREFETCH_BLOCK_MARKER =
  /^\[(?:项目检查已完成|实现评估已完成|代码审计已完成|测试已执行完毕)/;

function isPrefetchInjectionMessage(
  content: string | Array<{ type: string; text?: string }>
): boolean {
  if (typeof content !== 'string') return false;
  return PREFETCH_BLOCK_MARKER.test(content.trim());
}

/** 助手刚表示尚未读完代码、需要继续读 */
const ASSISTANT_CONTINUE_READ_PATTERN =
  /(?:读|看).{0,12}(?:代码|源|实现)|让我.{0,8}读|直接读|不是看文档|未完成|尚未.{0,6}读/i;

/** 「继续啊」等续跑：看「继续」前最后一轮真实对话，而非整个窗口关键词扫描 */
export function sessionNeedsCodeAudit(
  history: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
): boolean {
  // history 末尾是当前「继续」用户消息
  const prior = history
    .slice(0, -1)
    .filter((m) => !isPrefetchInjectionMessage(m.content));

  const lastAssistant = [...prior].reverse().find((m) => m.role === 'assistant');
  const lastUser = [...prior].reverse().find((m) => m.role === 'user');

  if (!lastAssistant && !lastUser) return false;

  const assistantText = lastAssistant ? extractMessageText(lastAssistant.content) : '';
  const userText = lastUser ? extractMessageText(lastUser.content) : '';

  if (ASSISTANT_CONTINUE_READ_PATTERN.test(assistantText)) return true;

  if (userText) {
    const intent = classifyToolIntent(userText);
    if (intent === 'review_implementation' || intent === 'code_audit' || intent === 'inspect_project') {
      return true;
    }
  }

  return false;
}

/** 结合当前消息与会话历史解析 DAG（支持「继续啊」续读代码） */
export function resolveDagPlanWithHistory(
  message: string,
  history: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
): DagPlan | null {
  const trimmed = message.trim();

  // 用户明确要求逐行/完整深读：禁用浅层预取
  if (DEEP_FULL_READ_PATTERN.test(trimmed)) {
    return null;
  }

  if (CONTINUE_PATTERN.test(trimmed) && sessionNeedsCodeAudit(history)) {
    // 已注入过代码审计块时再「继续」→ 不再重复同套浅读（避免空转循环）
    if (historyHasPrefetchIntent(history, '代码审计已完成')) {
      return null;
    }
    // 上一轮真实用户诉求（排除当前「继续」消息）
    const priorUser = [...history]
      .slice(0, -1)
      .reverse()
      .find((m) => m.role === 'user' && !isPrefetchInjectionMessage(m.content));
    const priorText = priorUser ? extractMessageText(priorUser.content) : '';
    if (DEEP_FULL_READ_PATTERN.test(priorText)) {
      return null;
    }
    return buildDagPlan('code_audit');
  }
  return resolveDagPlan(message);
}

function buildReadNodes(group: number): DagNodeSpec[] {
  return [
    { id: 'read_pkg', name: 'Read', input: { path: 'package.json' }, group },
    { id: 'read_readme', name: 'Read', input: { path: 'README.md' }, group },
    { id: 'read_claude', name: 'Read', input: { path: 'CLAUDE.md' }, group },
    { id: 'glob_src', name: 'Glob', input: { pattern: 'src/**/*.ts' }, group },
  ];
}

function buildGitNodes(group: number, opts: { names: boolean; security: boolean }): DagNodeSpec[] {
  const nodes: DagNodeSpec[] = [
    { id: 'git_status', name: 'Bash', input: { command: GIT_STATUS }, group },
    { id: 'git_diff_stat', name: 'Bash', input: { command: GIT_DIFF_STAT }, group },
    { id: 'git_log', name: 'Bash', input: { command: GIT_LOG_ONELINE }, group },
  ];
  if (opts.names) {
    nodes.push({
      id: 'git_diff_names',
      name: 'Bash',
      input: { command: GIT_DIFF_NAMES },
      group,
    });
  }
  if (opts.security) {
    nodes.push({
      id: 'security_scan',
      name: 'Bash',
      input: { command: SECURITY_DIFF_SCAN },
      group,
    });
  }
  return nodes;
}

export function buildDagPlan(intent: ToolIntent): DagPlan {
  if (intent === 'run_tests') {
    return {
      intent,
      nodes: [
        { id: 'read_pkg', name: 'Read', input: { path: 'package.json' }, group: 0 },
        {
          id: 'run_tests',
          name: 'Bash',
          input: { command: 'npm test 2>&1 | tail -40' },
          group: 1,
        },
      ],
    };
  }

  if (intent === 'code_audit') {
    return {
      intent: 'code_audit',
      nodes: [
        ...CORE_SOURCE_READS,
        { id: 'read_model_stream', name: 'Read', input: { path: 'src/agent/model-stream.ts', limit: 100 }, group: 0 },
        { id: 'read_task_tool', name: 'Read', input: { path: 'src/tools/task.ts', limit: 80 }, group: 0 },
        { id: 'read_e2e', name: 'Read', input: { path: 'test/e2e/agent-happy-path.test.ts', limit: 80 }, group: 0 },
        { id: 'read_engine_test', name: 'Read', input: { path: 'test/engine-query.test.ts', limit: 100 }, group: 0 },
      ],
    };
  }

  if (intent === 'review_implementation') {
    return {
      intent: 'review_implementation',
      nodes: [
        ...buildReadNodes(0),
        ...buildGitNodes(1, { names: true, security: true }),
        ...CORE_SOURCE_READS.map((n) => ({ ...n, group: 1 })),
        {
          id: 'services_tree',
          name: 'Bash',
          input: { command: SERVICES_TREE_CMD },
          group: 1,
        },
        {
          id: 'test_stats',
          name: 'Bash',
          input: { command: TEST_STATS_CMD },
          group: 1,
        },
        {
          id: 'contracts_check',
          name: 'Bash',
          input: { command: CONTRACTS_CMD },
          group: 1,
        },
        {
          id: 'npm_test_summary',
          name: 'Bash',
          input: { command: NPM_TEST_SUMMARY_CMD },
          group: 1,
        },
        {
          id: 'ci_check',
          name: 'Bash',
          input: { command: CI_CHECK_CMD },
          group: 1,
        },
        {
          id: 'coverage_tracked',
          name: 'Bash',
          input: { command: COVERAGE_TRACKED_CMD },
          group: 1,
        },
        {
          id: 'arch_wire',
          name: 'Bash',
          input: { command: ARCH_WIRE_CMD },
          group: 1,
        },
      ],
    };
  }

  return {
    intent: 'inspect_project',
    nodes: [
      ...buildReadNodes(0),
      ...buildGitNodes(1, { names: true, security: false }),
      ...CORE_SOURCE_READS.map((n) => ({ ...n, group: 1 })),
      {
        id: 'coverage_tracked',
        name: 'Bash',
        input: { command: COVERAGE_TRACKED_CMD },
        group: 1,
      },
      {
        id: 'arch_wire',
        name: 'Bash',
        input: { command: ARCH_WIRE_CMD },
        group: 1,
      },
    ],
  };
}

export function resolveDagPlan(message: string): DagPlan | null {
  const intent = classifyToolIntent(message);
  if (!intent) return null;
  return buildDagPlan(intent);
}
