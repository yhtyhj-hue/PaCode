/**
 * Enhanced Renderer
 *
 * Claude Code CLI 风格：紧凑工具摘要、Accomplishing 任务树、折叠 transcript
 */

import { ToolCall, ToolResult } from '../pkg/types.js';
import { formatCompactToolSummary } from './tool-summary.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const ORANGE = '\x1b[38;5;208m';
const WHITE = '\x1b[97m';
const RED = '\x1b[31m';

export class EnhancedRenderer {
  /** Skill 加载 */
  renderSkillLoaded(skillNames: string[]): void {
    const label = skillNames.map((n) => `/${n}`).join(', ');
    process.stdout.write(`\n${GREEN}✓${RESET} Successfully loaded skill ${label}\n`);
  }

  /**
   * CC 风格单行工具摘要：Read 3 files (ctrl+o to expand)
   */
  renderCompactToolActivity(tools: ToolCall[], options?: { hiddenCount?: number }): void {
    if (tools.length === 0) return;
    const summary = formatCompactToolSummary(tools);
    const extra =
      options?.hiddenCount && options.hiddenCount > 0
        ? ` · +${options.hiddenCount} more`
        : '';
    process.stdout.write(`${DIM}${summary}${extra} (ctrl+o to expand)${RESET}\n`);
  }

  /** @deprecated 使用 renderCompactToolActivity */
  renderTranscriptExpandHint(hiddenCount: number): void {
    if (hiddenCount <= 0) return;
    process.stdout.write(`${DIM}  +${hiddenCount} more (ctrl+o to expand)${RESET}\n`);
  }

  /** 展开 transcript 条目 */
  renderTranscriptEntry(label: string, detail?: string): void {
    process.stdout.write(`${DIM}⏺${RESET} ${label}\n`);
    if (detail) {
      const lines = detail.split('\n').slice(0, 8);
      for (const line of lines) {
        process.stdout.write(`${DIM}  ↳${RESET} ${line.slice(0, 100)}\n`);
      }
      if (detail.split('\n').length > 8) {
        process.stdout.write(`${DIM}  ↳ ...${RESET}\n`);
      }
    }
  }

  /**
   * 预取 worker 进度：开始时只打一行，避免空 □ 任务树占屏。
   * 这是同进程 DAG 工具批处理，不是 SubagentManager 子代理。
   */
  renderAgentsStarting(
    agents: Array<{ label: string }>,
    options: { elapsedSec?: number } = {}
  ): void {
    if (!agents.length) return;
    const elapsed = Math.max(1, options.elapsedSec ?? 1);
    const labels = agents.map((a) => a.label).join(' · ');
    process.stdout.write(
      `\n${ORANGE}*${RESET} ${ORANGE}Running ${agents.length} explore subagents…${RESET}${DIM} (${elapsed}s)${RESET}\n`
    );
    process.stdout.write(`${DIM}  ${labels}${RESET}\n`);
  }

  /**
   * 完成后的任务树（全部 ■ / 错误态）
   */
  renderAccomplishingBlock(
    tasks: Array<{ label: string; status: string }>,
    options: { elapsedSec?: number; outputTokens?: number; maxVisible?: number; doneHeader?: boolean } = {}
  ): void {
    if (!tasks.length) return;

    const elapsed = Math.max(1, options.elapsedSec ?? 1);
    const tokens = options.outputTokens ?? 0;
    const tokenPart = tokens > 0 ? ` · ↓ ${tokens} tokens` : '';
    const header = options.doneHeader
      ? `${GREEN}*${RESET} ${GREEN}Explore complete${RESET}${DIM} (${elapsed}s${tokenPart})${RESET}`
      : `${ORANGE}*${RESET} ${ORANGE}Accomplishing…${RESET}${DIM} (${elapsed}s${tokenPart})${RESET}`;

    process.stdout.write(`\n${header}\n`);

    const max = options.maxVisible ?? 5;
    const visible = tasks.slice(0, max);
    for (const task of visible) {
      const box =
        task.status === 'done'
          ? `${GREEN}■${RESET}`
          : task.status === 'error'
            ? `${RED}■${RESET}`
            : `${GREEN}□${RESET}`;
      const labelStyle =
        task.status === 'done' ? DIM : task.status === 'error' ? RED : GREEN;
      process.stdout.write(`  ${DIM}└${RESET} ${box} ${labelStyle}${task.label}${RESET}\n`);
    }

    const pending = tasks.length - max;
    if (pending > 0) {
      process.stdout.write(`${DIM}  … +${pending} pending${RESET}\n`);
    }
  }

  /** 并行预取 worker — 完成时画 ■ 树；进行中用 renderAgentsStarting */
  renderParallelAgents(
    agents: Array<{
      label: string;
      status: string;
      toolCalls: number;
      currentTool?: string;
    }>,
    options?: { header?: string; elapsedSec?: number; outputTokens?: number }
  ): void {
    if (!agents.length) return;

    const isComplete = agents.every((a) => a.status === 'done' || a.status === 'error');
    if (!isComplete) {
      this.renderAgentsStarting(agents, { elapsedSec: options?.elapsedSec });
      return;
    }

    this.renderAccomplishingBlock(
      agents.map((a) => ({ label: a.label, status: a.status })),
      {
        elapsedSec: options?.elapsedSec,
        outputTokens: options?.outputTokens,
        doneHeader: true,
      }
    );
  }

  /** 模型工具调用 — 单行，默认折叠（详情在 ctrl+o） */
  renderToolUse(tool: ToolCall, options?: { leadingNewline?: boolean }): void {
    const argsStr = this.formatToolArgs(tool);
    const prefix = options?.leadingNewline === false ? '' : '\n';
    process.stdout.write(`${prefix}${DIM}⏺${RESET} ${tool.name}(${argsStr})\n`);
  }

  /** 预取完成 — 紧凑摘要 */
  renderPrefetchComplete(tools: ToolCall[]): void {
    this.renderCompactToolActivity(tools);
  }

  /** 工具结果 — 不 dump 正文 */
  renderToolResult(tool: ToolCall, result: ToolResult): void {
    if (result.isError) {
      const text = result.content[0]?.type === 'text' ? result.content[0].text : 'Error';
      process.stdout.write(`${DIM}  ↳${RESET} ${RED}${text.slice(0, 120)}${RESET}\n`);
      return;
    }

    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    const summary = this.summarizeToolOutput(tool, text);
    if (summary) {
      process.stdout.write(`${DIM}  ↳${RESET} ${DIM}${summary}${RESET}\n`);
    }
  }

  private formatToolArgs(tool: ToolCall): string {
    return Object.entries(tool.input)
      .map(([k, v]) => {
        const value = typeof v === 'string' ? v : JSON.stringify(v);
        const truncated = value.length > 48 ? value.slice(0, 45) + '...' : value;
        return `${k}=${truncated}`;
      })
      .join(' ');
  }

  private summarizeToolOutput(tool: ToolCall, text: string): string {
    if (!text) return 'done';
    if (tool.name === 'Read') {
      const lines = text.split('\n').length;
      const path = String(tool.input['path'] ?? '');
      return path ? `${lines} lines` : `${lines} lines`;
    }
    if (tool.name === 'Glob') {
      const count = text.split('\n').filter(Boolean).length;
      return `${count} paths`;
    }
    if (tool.name === 'Bash') {
      const first = text.split('\n').find((l) => l.trim()) ?? 'ok';
      return first.length > 72 ? `${first.slice(0, 69)}...` : first;
    }
    if (tool.name === 'Grep') {
      const count = text.split('\n').filter(Boolean).length;
      return `${count} matches`;
    }
    return text.length > 72 ? `${text.slice(0, 69)}...` : text;
  }

  async renderPermissionPrompt(
    toolName: string,
    action: string,
    shouldAbort?: () => boolean
  ): Promise<boolean> {
    if (shouldAbort?.()) return false;

    return new Promise((resolve) => {
      console.log('');
      console.log(`${YELLOW}?${RESET} ${BOLD}Permission Request${RESET}`);
      console.log(`  ${DIM}Tool:${RESET}   ${toolName}`);
      console.log(`  ${DIM}Action:${RESET} ${action}`);
      console.log('');
      process.stdout.write(`${YELLOW}Allow?${RESET} [${BOLD}y${RESET}]es/${BOLD}n${RESET}]o: `);

      const cleanup = (): void => {
        process.stdin.off('data', onData);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      };

      const finish = (allowed: boolean): void => {
        cleanup();
        console.log(allowed ? `${GREEN}✓${RESET} Allowed` : `${RED}✗${RESET} Denied`);
        resolve(allowed);
      };

      if (process.stdin.isTTY) process.stdin.setRawMode(true);

      const onData = (data: Buffer) => {
        if (shouldAbort?.()) {
          finish(false);
          return;
        }

        const char = data.toString();
        if (char === '\u0003') {
          finish(false);
          return;
        }

        const answer = char.trim().toLowerCase();
        if (answer === 'y' || answer === '') {
          finish(true);
        } else if (answer === 'n') {
          finish(false);
        }
      };

      process.stdin.on('data', onData);
    });
  }

  /** 流式 markdown — 列表项转为 CC 实心圆点 */
  renderMarkdown(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`)
      .replace(/\*(.+?)\*/g, `${ITALIC}$1${RESET}`)
      .replace(/_(.+?)_/g, `${ITALIC}$1${RESET}`)
      .replace(/`(.+?)`/g, `${CYAN}$1${RESET}`)
      .replace(/^#{1,6}\s+(.+)$/gm, `${CYAN}${BOLD}$1${RESET}`)
      .replace(/^[-*]\s+/gm, `${WHITE}●${RESET} `);
  }
}

export const renderer = new EnhancedRenderer();
