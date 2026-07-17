/**
 * /plan 只读展示 — TUI 与测试共用（不含 execute / 生成）
 */

import {
  getPlanManager,
  formatPlanExecutionReport,
} from '../agent/plan-mode.js';

/** 返回纯文本行；未知子命令返回 usage */
export function formatPlanReadOnlyLines(arg = ''): string[] {
  const planManager = getPlanManager();
  const cmd = arg.trim();

  if (!cmd) {
    const plan = planManager.getActive();
    if (!plan) {
      return [
        'Usage: /plan | /plan list | /plan report',
        '(TUI is read-only; use REPL for approve/reject/execute)',
      ];
    }
    const lines = [planManager.formatPlanMessage(plan)];
    if (plan.status === 'completed' || plan.steps.some((s) => s.status === 'failed')) {
      lines.push('', formatPlanExecutionReport(plan));
    }
    lines.push('', `Status: ${plan.status} | /plan list | /plan report`);
    return lines;
  }

  if (cmd === 'list') {
    const plans = planManager.list();
    if (plans.length === 0) return ['No plans yet.'];
    return plans.map(
      (p) => `  ${p.id} [${p.status}] ${p.title} (${p.steps.length} steps)`
    );
  }

  if (cmd === 'report') {
    const plan = planManager.getActive();
    if (!plan) return ['No active plan.'];
    return [formatPlanExecutionReport(plan)];
  }

  return [
    `Unknown or unsupported in TUI: /plan ${cmd}`,
    'Use /plan | /plan list | /plan report (execute/approve via REPL)',
  ];
}
