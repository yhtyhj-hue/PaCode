/**
 * DAG 执行结果 → user 文本（不进 tool_result 协议）
 */

import { ToolCall, ToolResult } from '../../pkg/types.js';
import { ToolIntent } from './types.js';

/** 凭证类敏感模式：捕获 key 名，替换右侧值。 */
const SECRET_PATTERNS: ReadonlyArray<{ re: RegExp; key: string }> = [
  { re: /(password)\s*[:=]\s*\S+/gi, key: 'password' },
  { re: /(secret)\s*[:=]\s*\S+/gi, key: 'secret' },
  { re: /(api[_-]?key)\s*[:=]\s*\S+/gi, key: 'api_key' },
  { re: /(private[_-]?key)\s*[:=]\s*\S+/gi, key: 'private_key' },
  { re: /(aws_access[_-]?key[_-]?id)\s*[:=]\s*\S+/gi, key: 'aws_access_key_id' },
  { re: /(bearer)\s+\S+/gi, key: 'bearer' },
  {
    re: /-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |OPENSSH )?PRIVATE KEY-----/g,
    key: 'private_key_block',
  },
];

/** 对文本中的凭证类内容做行级 mask：保留模式关键字，右侧值替换为 [REDACTED:<key>] */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const { re, key } of SECRET_PATTERNS) {
    if (key === 'private_key_block') {
      redacted = redacted.replace(re, `[REDACTED:${key}]`);
    } else {
      redacted = redacted.replace(re, (_m, k) => `[REDACTED:${(k ?? key).toString().toLowerCase()}]`);
    }
  }
  return redacted;
}

/** 判断该 Bash run 是否来自 SECURITY_DIFF_SCAN 敏感扫描 */
function isSecurityScanRun(tool: ToolCall): boolean {
  if (tool.name !== 'Bash') return false;
  const cmd = tool.input['command'];
  if (typeof cmd !== 'string') return false;
  if (cmd.includes('SECURITY_DIFF_SCAN')) return true;
  // Fallback：识别形如 `grep -iE '(password|...)' ...` 的安全扫描命令
  return /grep\s+-iE/i.test(cmd) && /\(password/i.test(cmd);
}

const INTENT_HEADERS: Record<ToolIntent, string> = {
  run_tests:
    '[测试已执行完毕。给出结构化总结：通过/失败、关键错误、下一步。可用工具补查失败细节。输出用 ● 列表，禁止 markdown/Unicode 表格。]',
  inspect_project:
    '[项目检查已完成。4 路并行 agent 已预取；可直接总结，也可再用 Read/Grep/Bash 补洞。**强制**：\n' +
    '1. 测试数以 npm test 摘要为准；coverage tracked=0 则禁止把 coverage/ 标为 P0。\n' +
    '2. engine_imports_scheduler>0 且 scheduler_has_llm=no → engine 调用 scheduler 做预取，不是双 Agent 循环，禁止标 P0「双轨并存」。\n' +
    '3. 输出只用 ● / ├ / └ 列表，禁止 |---| 或 ┌─┐ 表格。]',
  review_implementation:
    '[实现评估已完成。4 路并行 agent 已预取；已读 engine/bash/permission 片段，可继续调用工具深读。**强制**：\n' +
    '1. 测试数量以 npm test 摘要为准，勿引用 README 过时数字。\n' +
    '2. coverage tracked=0 且 gitignore 含 coverage/ → 禁止「coverage 仍被跟踪 / 建议 git rm --cached」类 P0。\n' +
    '3. prefetch_calls>0 且 scheduler_has_llm=no → 单一 QueryEngine 循环 + L1 预取，禁止「双层 Agent 循环」P0。\n' +
    '4. P0 仅用于有预取证据的安全/正确性阻塞；文档期望 gap 标 P2。\n' +
    '5. 输出 ● 列表（可含实测对比），禁止任何表格。禁止说「未实读/工具结果缺失」。]',
  code_audit:
    '[代码审计已完成。下方为预取片段；需要逐行或更多文件时请继续调用 Read/Grep。输出 ● 列表禁止表格；禁止说「工具结果缺失」。]',
};

export function formatDagResults(
  intent: ToolIntent,
  runs: Array<{ tool: ToolCall; result: ToolResult }>,
  skillMarkdown?: string
): string {
  const sections = runs.map(({ tool, result }) => {
    const args = Object.entries(tool.input)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');
    const text = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    // 安全扫描输出走脱敏路径；其他工具输出保留原值
    const safeText = isSecurityScanRun(tool) ? redactSecrets(text) : text;
    const maxLen = tool.name === 'Glob' ? 3000 : tool.name === 'Bash' ? 4000 : 6000;
    const body = safeText.length > maxLen ? `${safeText.slice(0, maxLen)}\n...(truncated)` : safeText;
    const prefix = result.isError ? '[error] ' : '';
    return `### ${tool.name}(${args})\n${prefix}${body}`;
  });

  const skillBlock =
    skillMarkdown && skillMarkdown.trim()
      ? `[Loaded skills context]\n\n${skillMarkdown.trim()}\n\n`
      : '';

  const errorCount = runs.filter((r) => r.result.isError).length;
  const errorNote =
    errorCount > 0
      ? `\n[Note: ${errorCount}/${runs.length} prefetch tool(s) returned errors — treat those sections as failed, not as successful audit evidence. Do not claim the audit is complete.]`
      : '';
  let header = INTENT_HEADERS[intent];
  if (errorCount > 0 && errorCount === runs.length) {
    header =
      '[预取未成功（全部失败）。禁止声称检查/审计已完成；请继续调用 Read/Grep/Bash 收集证据。输出 ● 列表，禁止表格。]';
  } else if (errorCount > 0) {
    header =
      `[预取部分失败（${errorCount}/${runs.length}）。仅未标 [error] 的段落可参考；禁止把整次检查标为已完成。输出 ● 列表，禁止表格。]`;
  }

  return `${header}${errorNote}\n\n${skillBlock}${sections.join('\n\n')}`;
}
