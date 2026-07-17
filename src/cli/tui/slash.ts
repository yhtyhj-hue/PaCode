/**
 * K7 TUI slash commands — 确定性命令，无 LLM
 */

import { PermissionMode, type MCPServerConnection, type SessionState } from '../../pkg/types.js';
import { formatDoctorReport, runDoctorChecks } from '../doctor.js';
import { formatGitDiffView } from '../git-diff-view.js';
import {
  getBridgeStatus,
  formatBridgeStatus,
  bridgeSessionOp,
  formatBridgeSessionOp,
  parseBridgeSessionArgs,
} from '../../services/bridge/index.js';
import { formatAgentsReportLines } from '../agents-display.js';
import { formatPlanReadOnlyLines } from '../plan-display.js';
import {
  applySessionState,
  formatResumeListLines,
  formatResumeSuccess,
  loadResumeSession,
} from '../resume-display.js';
import { getSessionResume, type SessionResume } from '../resume.js';
import { formatMcpReportLines, listMcpConnections } from '../mcp-display.js';
import { getMCPClient } from '../../mcp/client.js';
import { runCompactForDisplay, type CompactDisplayOptions } from '../compact-display.js';
import {
  formatVoiceStatus,
  getVoiceStatus,
  startVoiceListening,
  stopVoiceListening,
  setBuddyNarration,
} from '../../services/voice/index.js';
import { formatCostReport } from '../cost-estimate.js';
import { listStyles, type OutputStyle } from '../output-styles.js';
import { formatCheckpointList, listCheckpoints, rewindToDetailed } from '../../services/checkpoint.js';
import { formatPermissionsReport } from '../../permission/format-display.js';
import { buildProjectBrief, formatProjectBrief } from '../../services/brief/index.js';
import { resolveAppConfig } from '../../pkg/app-config.js';
import {
  formatContextLines,
  formatMemoryLines,
  formatModelLines,
  formatProvidersLines,
} from '../info-display.js';
import { initClaudeMd } from '../init-display.js';
import { formatCronLines } from '../cron-display.js';
import {
  formatEffortStatus,
  parseEffortLevel,
} from '../effort.js';
import type { TuiController } from './app.js';

export const TUI_SLASH_HELP =
  '/help /clear /new /status /mode /model /effort /vim /cost /style /context /memory /providers /cron /init /doctor /diff /agents /plan /resume /compact /mcp /bridge /voice /permissions /brief /rewind /exit';

export interface TuiSlashContext {
  ctl: TuiController;
  session: SessionState;
  model: string;
  apiKeyPresent: boolean;
  tokenUsage: { input: number; output: number };
  outputStyle: OutputStyle;
  setOutputStyle: (s: OutputStyle) => void;
  /** 测试可注入 cwd；默认 process.cwd() */
  cwd?: string;
  /** 测试可注入 rewind 实现 */
  rewindFn?: typeof rewindToDetailed;
  /** 测试可注入 SessionResume */
  resume?: SessionResume;
  /** 恢复后可选回调（如 SessionManager.restoreSession） */
  onSessionRestored?: (state: SessionState) => void;
  apiKey?: string;
  baseUrl?: string;
  /** 测试注入 compactSession */
  compactFn?: CompactDisplayOptions['compactFn'];
  onSessionCompacted?: (session: SessionState) => void;
  /** 测试注入 MCP connections */
  mcpConnections?: MCPServerConnection[];
  setModel?: (model: string) => void;
  providerName?: string;
}

/** 处理 TUI slash；返回 true 表示已处理 */
export async function handleTuiSlash(
  text: string,
  ctx: TuiSlashContext
): Promise<boolean> {
  if (!text.startsWith('/')) return false;
  const [cmd, ...args] = text.slice(1).split(/\s+/);
  const { ctl, session } = ctx;

  switch (cmd) {
    case 'help':
      ctl.appendSystem(TUI_SLASH_HELP);
      return true;
    case 'clear':
    case 'reset':
    case 'new':
      session.messages = [];
      ctl.appendSystem('Conversation cleared');
      return true;
    case 'status':
      ctl.appendSystem(
        `session=${session.sessionId} messages=${session.messages.length} mode=${session.mode} model=${ctx.model} style=${ctx.outputStyle}`
      );
      return true;
    case 'mode': {
      const next = args[0];
      const allowed = Object.values(PermissionMode) as string[];
      if (!next || !allowed.includes(next)) {
        ctl.appendSystem(`Usage: /mode ${allowed.join('|')}`);
        return true;
      }
      session.mode = next as PermissionMode;
      ctl.setMode(next as PermissionMode);
      ctl.appendSystem(`mode=${next}`);
      return true;
    }
    case 'cost':
      for (const line of formatCostReport(
        ctx.model,
        ctx.tokenUsage.input,
        ctx.tokenUsage.output
      )) {
        ctl.appendSystem(line);
      }
      return true;
    case 'style': {
      const name = args[0] as OutputStyle | undefined;
      const styles = listStyles();
      if (!name) {
        ctl.appendSystem(`styles: ${styles.join('|')} (current=${ctx.outputStyle})`);
        return true;
      }
      if (!styles.includes(name)) {
        ctl.appendSystem(`Unknown style. Use: ${styles.join('|')}`);
        return true;
      }
      ctx.setOutputStyle(name);
      ctl.appendSystem(`style=${name}`);
      return true;
    }
    case 'doctor': {
      const report = formatDoctorReport(
        runDoctorChecks({
          hasApiKey: ctx.apiKeyPresent,
          model: ctx.model,
          mode: session.mode,
        })
      );
      for (const line of report.split('\n').filter(Boolean)) {
        ctl.appendSystem(line);
      }
      return true;
    }
    case 'diff': {
      const view = formatGitDiffView(process.cwd());
      for (const line of view.split('\n').slice(0, 40)) {
        ctl.appendSystem(line || ' ');
      }
      return true;
    }
    case 'context':
      for (const line of formatContextLines({
        messageCount: session.messages.length,
        inputTokens: ctx.tokenUsage.input,
        outputTokens: ctx.tokenUsage.output,
      })) {
        ctl.appendSystem(line);
      }
      return true;
    case 'memory':
      for (const line of formatMemoryLines(ctx.cwd ?? process.cwd())) {
        ctl.appendSystem(line);
      }
      return true;
    case 'model': {
      const name = args.join(' ').trim();
      if (!name) {
        for (const line of formatModelLines(ctx.model)) ctl.appendSystem(line);
        return true;
      }
      ctx.setModel?.(name);
      ctl.appendSystem(`Model: ${name}`);
      return true;
    }
    case 'effort': {
      const level = parseEffortLevel(args[0]);
      if (!level) {
        ctl.appendSystem(formatEffortStatus(session.effort));
        return true;
      }
      session.effort = level;
      ctl.appendSystem(formatEffortStatus(level));
      return true;
    }
    case 'vim':
      ctl.appendSystem(
        'Vim mode applies to the classic REPL line editor (/vim on|off). TUI uses Ink input.'
      );
      return true;
    case 'providers':
      for (const line of formatProvidersLines()) ctl.appendSystem(line);
      return true;
    case 'cron': {
      for (const line of formatCronLines(args)) {
        for (const part of line.split('\n')) ctl.appendSystem(part || ' ');
      }
      return true;
    }
    case 'init': {
      const cwd = ctx.cwd ?? process.cwd();
      const confirmed = await ctl.askConfirm(`Create CLAUDE.md in ${cwd}?`);
      if (!confirmed) {
        ctl.appendSystem('Init cancelled');
        return true;
      }
      const result = initClaudeMd(cwd);
      for (const line of result.lines) {
        if (result.ok) ctl.appendSystem(line);
        else ctl.appendError(line);
      }
      return true;
    }
    case 'compact': {
      const instructions = args.join(' ').trim();
      const outcome = await runCompactForDisplay(session, {
        apiKey: ctx.apiKey,
        baseUrl: ctx.baseUrl,
        model: ctx.model,
        instructions,
        compactFn: ctx.compactFn,
      });
      for (const line of outcome.lines) {
        if (outcome.ok) ctl.appendSystem(line);
        else ctl.appendError(line);
      }
      if (outcome.ok) ctx.onSessionCompacted?.(session);
      return true;
    }
    case 'mcp': {
      const connections = listMcpConnections(ctx.mcpConnections);
      for (const line of formatMcpReportLines(connections)) {
        ctl.appendSystem(line);
      }
      return true;
    }
    case 'resume': {
      const resume = ctx.resume ?? getSessionResume();
      const id = args[0];
      if (!id) {
        for (const line of formatResumeListLines(resume)) {
          ctl.appendSystem(line);
        }
        return true;
      }
      const loaded = loadResumeSession(id, resume);
      if (!loaded.ok) {
        for (const line of loaded.lines) ctl.appendError(line);
        return true;
      }
      // 确认后再覆盖当前会话（与 /rewind 同级谨慎）
      const confirmed = await ctl.askConfirm(
        `Resume session ${id}? Current conversation will be replaced.`
      );
      if (!confirmed) {
        ctl.appendSystem('Resume cancelled');
        return true;
      }
      applySessionState(session, loaded.state);
      ctl.setMode(loaded.state.mode);
      ctx.onSessionRestored?.(loaded.state);
      ctl.appendSystem(formatResumeSuccess(loaded.state));
      return true;
    }
    case 'plan': {
      const planArg = args.join(' ').trim();
      for (const line of formatPlanReadOnlyLines(planArg)) {
        for (const part of line.split('\n')) {
          ctl.appendSystem(part || ' ');
        }
      }
      return true;
    }
    case 'agents':
      ctl.appendSystem('Agents');
      for (const line of formatAgentsReportLines()) {
        ctl.appendSystem(line || ' ');
      }
      return true;
    case 'bridge': {
      const sessionReq = parseBridgeSessionArgs(args);
      if (sessionReq) {
        for (const line of formatBridgeSessionOp(bridgeSessionOp(sessionReq))
          .split('\n')
          .filter(Boolean)) {
          ctl.appendSystem(line);
        }
        return true;
      }
      let connections: import('../../pkg/types.js').MCPServerConnection[] = [];
      try {
        connections = getMCPClient().listConnections();
      } catch {
        connections = [];
      }
      for (const line of formatBridgeStatus(getBridgeStatus({ connections }))
        .split('\n')
        .filter(Boolean)) {
        ctl.appendSystem(line);
      }
      return true;
    }
    case 'voice': {
      const sub = (args[0] ?? 'status').toLowerCase();
      let report = getVoiceStatus();
      if (sub === 'start') report = startVoiceListening();
      else if (sub === 'stop') report = stopVoiceListening();
      else if (sub === 'buddy') {
        const on = (args[1] ?? 'on').toLowerCase();
        setBuddyNarration(on !== 'off' && on !== '0' && on !== 'false');
        report = getVoiceStatus();
      }
      for (const line of formatVoiceStatus(report).split('\n').filter(Boolean)) {
        ctl.appendSystem(line);
      }
      return true;
    }
    case 'permissions': {
      const app = resolveAppConfig();
      for (const line of formatPermissionsReport(session.mode, app.permissions)) {
        ctl.appendSystem(line);
      }
      return true;
    }
    case 'brief': {
      const brief = formatProjectBrief(buildProjectBrief(process.cwd()));
      for (const line of brief.split('\n').slice(0, 30)) {
        ctl.appendSystem(line || ' ');
      }
      return true;
    }
    case 'rewind': {
      const id = args[0];
      const cwd = ctx.cwd ?? process.cwd();
      if (!id) {
        ctl.appendSystem(formatCheckpointList(listCheckpoints(cwd)));
        ctl.appendSystem('Usage: /rewind <id>  (y/n confirm before apply)');
        return true;
      }
      // 核心：破坏性恢复前必须 Ink 确认
      const confirmed = await ctl.askConfirm(
        `Rewind working tree to checkpoint ${id}? Uncommitted changes may be overwritten.`
      );
      if (!confirmed) {
        ctl.appendSystem('Rewind cancelled');
        return true;
      }
      const rewind = ctx.rewindFn ?? rewindToDetailed;
      const result = rewind(id, cwd);
      if (result.ok) {
        ctl.appendSystem(`Rewound to ${id}`);
      } else {
        ctl.appendError(result.message);
      }
      return true;
    }
    case 'exit':
    case 'quit':
      return false; // 留给 App 层 exit
    default:
      ctl.appendSystem(`Unknown slash: /${cmd}. Try /help`);
      return true;
  }
}
