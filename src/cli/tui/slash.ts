/**
 * K7 TUI slash commands — 确定性命令，无 LLM
 */

import { PermissionMode, type SessionState } from '../../pkg/types.js';
import { formatDoctorReport, runDoctorChecks } from '../doctor.js';
import { formatGitDiffView } from '../git-diff-view.js';
import { getBridgeStatus, formatBridgeStatus } from '../../services/bridge/index.js';
import { formatAgentsReportLines } from '../agents-display.js';
import { formatPlanReadOnlyLines } from '../plan-display.js';
import { getMCPClient } from '../../mcp/client.js';
import { formatVoiceStatus } from '../../services/voice/index.js';
import { formatCostReport } from '../cost-estimate.js';
import { listStyles, type OutputStyle } from '../output-styles.js';
import { formatCheckpointList, listCheckpoints, rewindToDetailed } from '../../services/checkpoint.js';
import { formatPermissionsReport } from '../../permission/format-display.js';
import { buildProjectBrief, formatProjectBrief } from '../../services/brief/index.js';
import { resolveAppConfig } from '../../pkg/app-config.js';
import type { TuiController } from './app.js';

export const TUI_SLASH_HELP =
  '/help /clear /status /mode /cost /style /doctor /diff /agents /plan /bridge /voice /permissions /brief /rewind /exit';

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
    case 'voice':
      for (const line of formatVoiceStatus().split('\n').filter(Boolean)) {
        ctl.appendSystem(line);
      }
      return true;
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
