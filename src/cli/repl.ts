/**
 * REPL - Interactive Chat Mode
 *
 * Continuous conversation like Claude Code CLI.
 * Implements core Claude Code slash commands.
 */

import readline from 'node:readline';
import { QueryEngine } from '../agent/engine.js';
import { SessionManager } from '../session/manager.js';
import { getToolRegistry, ToolRegistry } from '../tools/registry.js';
import { registerCoreTools } from '../tools/bootstrap.js';
import { bootstrapMcpTools } from '../mcp/loader.js';
import { getMCPClient } from '../mcp/client.js';
import { formatMcpReportLines, listMcpConnections } from './mcp-display.js';
import { runCompactForDisplay } from './compact-display.js';
import {
  formatContextLines,
  formatMemoryLines,
  formatModelLines,
  formatProvidersLines,
} from './info-display.js';
import { initClaudeMd } from './init-display.js';
import { formatCronLines } from './cron-display.js';
import { bootstrapHooks, runSessionHooks, runStopHooks } from '../hooks/loader.js';
import { bootstrapPlugins, PluginCommand } from '../plugins/bootstrap.js';
import { HookRegistry } from '../hooks/registry.js';
import { getSessionResume } from './resume.js';
import {
  formatResumeListLines,
  formatResumeSuccess,
  loadResumeSession,
} from './resume-display.js';
import { PermissionMode, MCPServerConnection, SessionState, HookType, type ImageSource } from '../pkg/types.js';
import { Provider, getCCSwitch, formatPresetTable } from '../pkg/ccswitch/index.js';
import { SkillsLoader } from '../skills/loader.js';
import { getSubagentManager } from '../agent/subagent.js';
import {
  getPlanManager,
  formatPlanExecutionKickoff,
  formatPlanExecutionReport,
} from '../agent/plan-mode.js';
import { parsePlanFromMarkdown, extractLastAssistantText } from '../agent/plan-parser.js';
import { ContextAssembler } from '../context/assembler.js';
import { renderer } from './enhanced-renderer.js';
import { StreamingMarkdownWriter, summarizeToolAction } from './streaming-markdown.js';
import { listStyles, getStyleOptions } from './output-styles.js';
import { ReplLineEditor } from './repl-line-editor.js';
import { formatUserMessage } from './repl-ui.js';
import { formatCostReport } from './cost-estimate.js';
import { confirmYesNo } from './confirm-prompt.js';
import { AskUserAbortedError } from '../services/ask-user/index.js';
import { formatPermissionsReport } from '../permission/format-display.js';
import { resolveAppConfig } from '../pkg/app-config.js';
import type { SlashMenuEntry } from './slash-menu.js';
import { isCtrlCKey, resolveCtrlCAction, shouldDedupeCtrlC } from './repl-interrupt.js';
import { ToolCall, ToolResult } from '../pkg/types.js';
import { TranscriptBuffer, isCtrlOKey } from './transcript-buffer.js';
import { QueryProgressLine } from './query-progress.js';
import { LiveTaskPanel, todosToPanelItems } from './live-task-panel.js';
import { ToolRunningLine, isLongRunningTool } from './tool-running-line.js';
import { getTodoStore } from '../context/todo-store.js';
import { getAgentPool } from '../services/agent-scheduler/index.js';
import { getTaskStore } from '../services/task-registry/index.js';
import { getTeamStore } from '../services/team/index.js';
import { getCoordinatorStore } from '../services/coordinator/index.js';
import { formatAgentsReport } from './agents-display.js';
import { buildProjectBrief, formatProjectBrief } from '../services/brief/index.js';
import { formatDoctorReport, runDoctorChecks } from './doctor.js';
import { formatGitDiffView } from './git-diff-view.js';
import {
  getBridgeStatus,
  formatBridgeStatus,
  bridgeSessionOp,
  formatBridgeSessionOp,
  parseBridgeSessionArgs,
} from '../services/bridge/index.js';
import {
  formatVoiceStatus,
  getVoiceStatus,
  startVoiceListening,
  stopVoiceListening,
  setBuddyNarration,
  setVoiceTranscriptHandler,
  buddySystemHint,
} from '../services/voice/index.js';
import {
  effortMaxTokens,
  formatEffortStatus,
  parseEffortLevel,
} from './effort.js';
import {
  getCronStore,
  MAX_CRON_DUE_PER_TURN,
  sanitizeCronPrompt,
} from '../services/cron/index.js';
import { cyclePermissionMode } from '../permission/cycle-mode.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[31m';

export class REPL {
  private inputEditor: ReplLineEditor | null = null;
  private engine: QueryEngine;
  private sessionManager: SessionManager;
  private toolRegistry: ToolRegistry;
  private provider: Provider;
  private mode: PermissionMode;
  private apiKey: string;
  private baseUrl?: string;
  private model: string;
  private exitRequested = false;
  private tokenUsage = { input: 0, output: 0 };
  private startTime = Date.now();
  private skillsLoader!: SkillsLoader;
  private mcpConnections: MCPServerConnection[] = [];
  private hookRegistry: HookRegistry;
  private pluginCommands: Map<string, PluginCommand> = new Map();
  private streamWriter = new StreamingMarkdownWriter(renderer);
  /** I5: current output style. Mutated by /style command. */
  private outputStyle: 'default' | 'cost' | 'full' | 'minimal' | undefined = undefined;
  private lastCtrlCAt = 0;
  private lastCtrlCHandledAt = 0;
  private isProcessing = false;
  private interruptRequested = false;
  private ctrlCListener: ((str: string, key: readline.Key) => void) | null = null;
  private sigintListener: (() => void) | null = null;
  /** 当前 query 的 transcript，供 ctrl+o 展开 */
  private queryTranscript: TranscriptBuffer | null = null;

  constructor(options: REPLOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.mode = options.mode;
    this.provider = options.provider;
    this.sessionManager = options.sessionManager ?? new SessionManager();
    this.toolRegistry = options.toolRegistry ?? getToolRegistry();
    this.hookRegistry = options.hookRegistry ?? new HookRegistry();

    this.skillsLoader = new SkillsLoader();
    const taskDeps = {
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      model: this.model,
      toolRegistry: this.toolRegistry,
    };
    registerCoreTools(this.toolRegistry, {
      task: taskDeps,
      skillsLoader: this.skillsLoader,
    });
    bootstrapHooks(this.hookRegistry);

    this.engine =
      options.engine ??
      new QueryEngine({
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        authStyle: options.authStyle ?? options.provider.authStyle,
        apiProtocol: options.apiProtocol ?? options.provider.apiProtocol,
        toolRegistry: this.toolRegistry,
        sessionManager: this.sessionManager,
        hookRegistry: this.hookRegistry,
        contextAssembler: new ContextAssembler({ skillsLoader: this.skillsLoader }),
        permissionPrompt: async (tool, batchTools) => this.promptForPermission(tool, batchTools),
        // AskUser：processMessage 已 pause editor（cooked stdin），禁止再开抢 raw mode 的 reader
        readLine: (prompt) => this.readAskUserLine(prompt),
      });

    if (options.initialSession) {
      this.sessionManager.restoreSession(options.initialSession);
      this.mode = options.initialSession.mode;
    }
  }

  async start(): Promise<void> {
    await this.skillsLoader.loadAll();
    await this.skillsLoader.loadSlashCommands();

    const mcpResult = await bootstrapMcpTools(this.toolRegistry);
    this.mcpConnections = mcpResult.connections;
    if (mcpResult.toolCount > 0) {
      console.log(
        `${DIM}  MCP: ${mcpResult.toolCount} tool(s) from ${mcpResult.connectedCount} server(s)${RESET}`
      );
    }
    for (const err of mcpResult.errors) {
      console.log(`${YELLOW}  ⚠ MCP ${err.name}: ${err.error}${RESET}`);
    }

    const pluginResult = await bootstrapPlugins(this.hookRegistry, {
      subagentManager: getSubagentManager(),
      toolRegistry: this.toolRegistry,
    });
    for (const cmd of pluginResult.commands) {
      this.pluginCommands.set(cmd.name, cmd);
    }
    if (pluginResult.plugins.length > 0) {
      console.log(
        `${DIM}  Plugins: ${pluginResult.plugins.length} loaded, ${pluginResult.commands.length} command(s), ${pluginResult.agentCount} agent(s), ${pluginResult.toolCount} tool(s)${RESET}`
      );
    }

    const session = this.getOrCreateSession();
    await runSessionHooks(this.hookRegistry, HookType.SESSION_START, session);

    this.printWelcome();

    this.inputEditor = new ReplLineEditor();
    setVoiceTranscriptHandler((text) => {
      this.inputEditor?.injectText(text);
    });
    this.beginInterruptListener();
    try {
      await this.runInputLoop(true);
    } finally {
      this.endInterruptListener();
    }
  }

  /** 主输入循环：四行输入区 + 自定义行编辑器 */
  private async runInputLoop(isFirst: boolean): Promise<void> {
    let first = isFirst;

    while (!this.exitRequested && this.inputEditor) {
      const input = await this.inputEditor.readLine({
        mode: this.mode,
        tokens: this.tokenUsage.input + this.tokenUsage.output,
        isFirst: first,
        slashCommands: this.getSlashMenuEntries(),
        onModeCycle: () => {
          this.mode = cyclePermissionMode(this.mode);
          this.getOrCreateSession().mode = this.mode;
          return this.mode;
        },
      });
      first = false;

      if (input === null) {
        this.exitRequested = true;
        break;
      }

      const display = this.inputEditor.getLastDisplayText() || input;
      const images = this.inputEditor.takePendingImages();
      const trimmed = input.trim();

      if (trimmed.startsWith('/')) {
        this.printUserTurn(display.trim() || trimmed);
        await this.dispatchSlashCommand(trimmed);
        if (this.exitRequested) break;
        continue;
      }

      if (!trimmed && images.length === 0) continue;

      if (trimmed === 'exit' || trimmed === 'quit') {
        this.exitRequested = true;
        break;
      }

      this.printUserTurn(display.trim() || trimmed || '[Image]');
      // 主轮消息以 ` &` 结尾 → 后台跑（非 Bash &）
      if (/\s&$/.test(trimmed)) {
        const prompt = trimmed.replace(/\s&$/, '').trim();
        if (prompt) {
          this.startBackgroundTurn(prompt);
          continue;
        }
      }
      await this.processMessage(trimmed || '(image)', images);
      if (this.exitRequested) break;
    }

    this.inputEditor?.close();
    this.printGoodbye();
    process.exit(0);
  }

  /** 全局 Ctrl+C：清输入 / 中断生成 / 双击退出 */
  private beginInterruptListener(): void {
    if (!process.stdin.isTTY || this.ctrlCListener) return;

    readline.emitKeypressEvents(process.stdin);

    this.ctrlCListener = (str, key) => {
      if (
        this.isProcessing &&
        this.queryTranscript &&
        isCtrlOKey(str, key ?? {})
      ) {
        this.dumpTranscript(this.queryTranscript);
        return;
      }
      if (!isCtrlCKey(str, key ?? {})) return;
      this.handleCtrlC();
    };

    this.sigintListener = () => {
      // raw 模式下 keypress 已处理 Ctrl+C，避免双触发
      if (this.inputEditor?.isActive()) return;
      this.handleCtrlC();
    };

    process.stdin.on('keypress', this.ctrlCListener);
    process.on('SIGINT', this.sigintListener);
  }

  private endInterruptListener(): void {
    if (this.ctrlCListener) {
      process.stdin.off('keypress', this.ctrlCListener);
      this.ctrlCListener = null;
    }
    if (this.sigintListener) {
      process.off('SIGINT', this.sigintListener);
      this.sigintListener = null;
    }
  }

  private handleCtrlC(): void {
    const now = Date.now();
    if (shouldDedupeCtrlC(this.lastCtrlCHandledAt, now)) return;
    this.lastCtrlCHandledAt = now;

    const action = resolveCtrlCAction({
      isProcessing: this.isProcessing,
      bufferLength: this.inputEditor?.getBufferLength() ?? 0,
      lastCtrlCAt: this.lastCtrlCAt,
      now,
    });

    switch (action) {
      case 'clear-buffer':
        process.stdout.write('\n^C\n');
        this.inputEditor?.clearBuffer();
        this.lastCtrlCAt = 0;
        return;
      case 'abort-processing':
        this.interruptRequested = true;
        process.stdout.write('\n^C\n');
        this.lastCtrlCAt = now;
        return;
      case 'hint-exit':
        this.inputEditor?.showExitHint(
          `${DIM}  再按一次 Ctrl+C 退出 PaCode${RESET}`
        );
        this.lastCtrlCAt = now;
        return;
      case 'exit':
        this.exitRequested = true;
        this.interruptRequested = true;
        this.inputEditor?.cancelForExit();
        return;
    }
  }

  private printWelcome(): void {
    console.log('');
    console.log(`${DIM}  Type a message below.${RESET}`);
    console.log('');
  }

  /** 对话区用户轮次（Claude Code 风格，无边框） */
  private printUserTurn(message: string): void {
    process.stdout.write(`${formatUserMessage(message)}\n\n`);
  }

  /** 自定义 + 插件 slash 命令，供输入菜单展示 */
  private getSlashMenuEntries(): SlashMenuEntry[] {
    const custom = this.skillsLoader.listSlashCommands().map((cmd) => ({
      command: `/${cmd.name}`,
      description: cmd.description,
    }));
    const plugins = Array.from(this.pluginCommands.values()).map((cmd) => ({
      command: `/${cmd.name}`,
      description: cmd.description,
    }));
    return [...custom, ...plugins];
  }

  private printGoodbye(): void {
    const session = this.sessionManager.getCurrentSession();
    if (session) {
      void runSessionHooks(this.hookRegistry, HookType.SESSION_STOP, session);
      this.sessionManager.saveSession(session);
    }

    process.stdout.write('\n');
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    const totalTokens = this.tokenUsage.input + this.tokenUsage.output;
    console.log(
      `${GREEN}✓${RESET} Session ended. ${DIM}Duration: ${elapsed}s | Tokens: ${totalTokens}${RESET}`
    );
  }

  /** 解析 slash 输入，不执行（供测试与 dispatch 共用） */
  peekSlashCommand(trimmed: string): SlashPeekResult | null {
    if (!trimmed.startsWith('/')) return null;

    const cmdName = trimmed.split(/\s+/)[0]!.slice(1);
    const arg = trimmed.includes(' ') ? trimmed.slice(trimmed.indexOf(' ') + 1).trim() : '';

    // K3: /brief 优先于 .claude/commands，走确定性构建
    if (cmdName === 'brief') {
      return { kind: 'builtin', command: '/brief' };
    }

    const customCmd = this.skillsLoader?.getSlashCommand(cmdName);
    if (customCmd) {
      return {
        kind: 'custom',
        prompt: customCmd.prompt.replace(/\$ARGUMENTS/g, arg),
      };
    }

    const pluginCmd = this.pluginCommands.get(cmdName);
    if (pluginCmd) {
      return {
        kind: 'plugin',
        name: pluginCmd.name,
        prompt: pluginCmd.prompt.replace(/\$ARGUMENTS/g, arg),
      };
    }

    return { kind: 'builtin', command: trimmed.split(/\s+/)[0]! };
  }

  /** 执行 slash 命令（REPL 与测试共用） */
  async dispatchSlashCommand(trimmed: string): Promise<void> {
    const peek = this.peekSlashCommand(trimmed);
    if (!peek) return;

    if (peek.kind === 'custom' || peek.kind === 'plugin') {
      await this.processMessage(peek.prompt);
      return;
    }

    await this.handleSlashCommand(trimmed);
  }

  registerPluginCommand(cmd: PluginCommand): void {
    this.pluginCommands.set(cmd.name, cmd);
  }

  getPermissionMode(): PermissionMode {
    return this.mode;
  }

  isExitRequested(): boolean {
    return this.exitRequested;
  }

  private async handleSlashCommand(cmd: string): Promise<void> {
    const [command, ...args] = cmd.split(/\s+/);
    const arg = args.join(' ');

    switch (command) {
      case '/help':
        this.printHelp();
        break;
      case '/clear':
      case '/reset':
      case '/new':
        await this.clearConversation();
        break;
      case '/compact':
        await this.compact(arg);
        break;
      case '/context':
        this.showContext();
        break;
      case '/status':
        this.printStatus();
        break;
      case '/cost':
        this.showCost();
        break;
      case '/memory':
        this.showMemory();
        break;
      case '/init':
        await this.initProject();
        break;
      case '/mcp':
        this.showMcp();
        break;
      case '/permissions':
        this.showPermissions();
        break;
      case '/resume':
        await this.handleResume(args);
        break;
      case '/model':
        this.handleModel(args);
        break;
      case '/mode':
        await this.handleMode(args);
        break;
      case '/agents':
        this.showAgents();
        break;
      case '/btw': {
        const prompt = arg.trim();
        if (!prompt) {
          console.log(`${DIM}Usage: /btw <prompt> — run agent turn in background${RESET}`);
          break;
        }
        this.startBackgroundTurn(prompt);
        break;
      }
      case '/plan':
        await this.handlePlan(arg);
        break;
      case '/providers':
        this.handleProviders(args);
        break;
      case '/style':
        this.handleStyle(args);
        break;
      case '/rewind':
        await this.handleRewind(args);
        break;
      case '/brief':
        this.handleBrief();
        break;
      case '/doctor':
        this.handleDoctor();
        break;
      case '/diff':
        this.handleDiff();
        break;
      case '/bridge':
        this.handleBridge(args);
        break;
      case '/voice':
        this.handleVoice(args);
        break;
      case '/cron':
        this.handleCron(args);
        break;
      case '/effort': {
        const level = parseEffortLevel(args[0]);
        const session = this.getOrCreateSession();
        if (!level) {
          console.log(`${DIM}${formatEffortStatus(session.effort)}${RESET}`);
          break;
        }
        session.effort = level;
        console.log(`${GREEN}✓${RESET} ${formatEffortStatus(level)}`);
        break;
      }
      case '/vim': {
        const on = args[0]?.toLowerCase();
        if (on === 'off' || on === '0' || on === 'false') {
          this.inputEditor?.setVimEnabled(false);
          console.log(`${GREEN}✓${RESET} Vim mode off`);
        } else if (on === 'on' || on === '1' || on === 'true' || !on) {
          this.inputEditor?.setVimEnabled(true);
          console.log(
            `${GREEN}✓${RESET} Vim mode on (Esc=normal, i/a=insert, hjkl move, x delete, d clear)`
          );
        } else {
          console.log(`${DIM}Usage: /vim [on|off]${RESET}`);
        }
        break;
      }
      case '/exit':
      case '/quit':
        this.exitRequested = true;
        break;
      default:
        console.log(`${YELLOW}?${RESET} Unknown command: ${command}. Try /help`);
    }
  }

  private printHelp(): void {
    console.log('');
    console.log(`${CYAN}${BOLD}Available Commands${RESET}`);
    console.log('');
    const groups: Record<string, [string, string][]> = {
      'Session Management': [
        ['/help', 'Show this help'],
        ['/clear', 'Clear conversation history (/reset /new)'],
        ['/new', 'Alias for /clear — start a fresh conversation'],
        ['/compact', 'Compress conversation to reduce tokens'],
        ['/context', 'Show context usage'],
        ['/resume', 'Resume a saved session'],
        ['/rewind', 'Rewind workspace to a checkpoint'],
        ['/exit', 'Exit REPL (/quit)'],
      ],
      Information: [
        ['/status', 'Show session info'],
        ['/doctor', 'Run local health checks'],
        ['/diff', 'git status + diff --stat (read-only)'],
        ['/bridge', 'Bridge status + remote MCP; /bridge session list|attach'],
        ['/voice', 'Voice STT pipe status (/voice start|stop|status)'],
        ['/cron', 'List/create/delete in-process scheduled prompts'],
        ['/cost', 'Show token usage and cost'],
        ['/memory', 'Show memory file locations'],
        ['/mcp', 'Show MCP server connections'],
        ['/permissions', 'Show permission rules'],
        ['/providers', 'List providers · use <name> · presets'],
        ['/brief', 'Project brief (CLAUDE.md / package.json / README)'],
        ['/agents', 'List subagents, tasks, teams, coordinator assignments'],
        ['/btw <prompt>', 'Run an agent turn in background (also: message &)'],
        ['/plan', 'Create or manage implementation plans'],
      ],
      Configuration: [
        ['/mode [name]', 'Change permission mode (or Shift+Tab)'],
        ['/model [name]', 'Show or change model'],
        ['/effort [low|medium|high]', 'Set maxTokens budget for replies'],
        ['/vim [on|off]', 'Toggle vi keybindings in the line editor'],
        ['/style [name]', 'Output style: default/cost/full/minimal'],
        ['/init', 'Initialize project with CLAUDE.md'],
      ],
    };
    for (const [group, cmds] of Object.entries(groups)) {
      console.log(`  ${MAGENTA}${group}${RESET}`);
      for (const [cmd, desc] of cmds) {
        console.log(`    ${CYAN}${cmd.padEnd(22)}${RESET}${desc}`);
      }
      console.log('');
    }

    // Custom slash commands from .claude/commands/*.md
    const customCommands = this.skillsLoader.listSlashCommands();
    if (customCommands.length > 0) {
      console.log(`  ${MAGENTA}Custom Commands${RESET}`);
      for (const cmd of customCommands) {
        const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : '';
        const fullCmd = `/${cmd.name}${hint}`;
        console.log(`    ${CYAN}${fullCmd.padEnd(22)}${RESET}${cmd.description}`);
      }
      console.log('');
    }

    const pluginCmds = Array.from(this.pluginCommands.values());
    if (pluginCmds.length > 0) {
      console.log(`  ${MAGENTA}Plugin Commands${RESET}`);
      for (const cmd of pluginCmds) {
        console.log(`    ${CYAN}${('/' + cmd.name).padEnd(22)}${RESET}${cmd.description}`);
      }
      console.log('');
    }

    console.log(
      `${DIM}Permission modes: plan, default, acceptEdits, auto, dontAsk, bypass${RESET}`
    );
    console.log('');
  }

  private printStatus(): void {
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    console.log('');
    console.log(`${CYAN}${BOLD}Session Status${RESET}`);
    console.log(`  ${DIM}Provider:${RESET}  ${this.provider.name}`);
    console.log(`  ${DIM}Model:${RESET}     ${this.model}`);
    if (this.baseUrl) console.log(`  ${DIM}Base URL:${RESET} ${this.baseUrl}`);
    console.log(`  ${DIM}Mode:${RESET}     ${this.mode}`);
    console.log(`  ${DIM}Duration:${RESET} ${elapsed}s`);
    console.log(
      `  ${DIM}Tokens:${RESET}   in=${this.tokenUsage.input} out=${this.tokenUsage.output}`
    );
    console.log('');
  }

  private async clearConversation(): Promise<void> {
    this.sessionManager.createSession({ mode: this.mode });
    getTaskStore().clear();
    getTeamStore().clear();
    getCoordinatorStore().clear();
    console.log(
      `${GREEN}✓${RESET} Conversation cleared ${DIM}(approvals + Task/Team/Coordinator reset)${RESET}`
    );
  }

  private async compact(instructions: string): Promise<void> {
    const session = this.sessionManager.getCurrentSession();
    console.log(`${DIM}⏺ Compacting conversation...${RESET}`);
    const outcome = await runCompactForDisplay(session, {
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      model: this.model,
      instructions,
    });
    if (outcome.ok) {
      this.sessionManager.saveSession(outcome.result.session);
      console.log(`${GREEN}✓${RESET} ${outcome.lines[0]}`);
      for (const line of outcome.lines.slice(1)) {
        console.log(`${DIM}${line}${RESET}`);
      }
    } else {
      const msg = outcome.lines[0] ?? 'Compaction failed';
      if (msg.startsWith('Compaction failed')) {
        console.log(`${RED}✗${RESET} ${msg}`);
      } else {
        console.log(`${YELLOW}⚠${RESET}  ${msg}`);
      }
    }
  }

  private showContext(): void {
    console.log('');
    const session = this.sessionManager.getCurrentSession();
    const lines = formatContextLines({
      messageCount: session?.messages.length ?? 0,
      inputTokens: this.tokenUsage.input,
      outputTokens: this.tokenUsage.output,
    });
    console.log(`${CYAN}${BOLD}${lines[0]}${RESET}`);
    for (const line of lines.slice(1)) {
      console.log(`${DIM}${line}${RESET}`);
    }
    console.log('');
  }

  private showCost(): void {
    console.log('');
    const lines = formatCostReport(this.model, this.tokenUsage.input, this.tokenUsage.output);
    console.log(`${CYAN}${BOLD}${lines[0]}${RESET}`);
    for (const line of lines.slice(1)) {
      console.log(`${DIM}${line}${RESET}`);
    }
    console.log('');
  }

  private showMemory(): void {
    console.log('');
    const lines = formatMemoryLines();
    console.log(`${CYAN}${BOLD}${lines[0]}${RESET}`);
    for (const line of lines.slice(1)) {
      console.log(`${DIM}${line}${RESET}`);
    }
    console.log('');
  }

  private async initProject(): Promise<void> {
    const result = initClaudeMd(process.cwd());
    if (result.ok) {
      console.log(`${GREEN}✓${RESET} ${result.lines[0]}`);
    } else {
      console.log(`${YELLOW}⚠${RESET}  ${result.lines[0]}`);
    }
  }

  private showMcp(): void {
    console.log('');
    const connections = this.mcpConnections.length
      ? this.mcpConnections
      : listMcpConnections();
    const lines = formatMcpReportLines(connections);
    console.log(`${CYAN}${BOLD}${lines[0]}${RESET}`);
    for (const line of lines.slice(1)) {
      console.log(`${DIM}${line}${RESET}`);
    }
    console.log('');
  }

  private showPermissions(): void {
    const { permissions } = resolveAppConfig();
    console.log('');
    const lines = formatPermissionsReport(this.mode, permissions);
    console.log(`${CYAN}${BOLD}${lines[0]}${RESET}`);
    for (const line of lines.slice(1)) {
      console.log(`${DIM}${line}${RESET}`);
    }
    console.log('');
  }

  private handleModel(args: string[]): void {
    if (args.length === 0) {
      for (const line of formatModelLines(this.model)) {
        console.log(`${DIM}${line}${RESET}`);
      }
      return;
    }
    this.model = args.join(' ');
    console.log(`${GREEN}✓${RESET} Model: ${this.model}`);
  }

  /** 同步读取一行用户确认（仅 confirm 场景使用；不与 inputEditor 交互） */
  private async readConfirmationLine(): Promise<string> {
    if (!this.inputEditor) return '';
    try {
      const result = await this.inputEditor.readLine({
        mode: this.mode,
        tokens: this.tokenUsage.input + this.tokenUsage.output,
        isFirst: false,
        slashCommands: [],
      });
      return (result ?? '').trim();
    } catch {
      return '';
    }
  }

  private async handleMode(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log(`Current mode: ${this.mode}`);
      console.log(`Available: plan, default, acceptEdits, auto, dontAsk, bypass`);
      return;
    }
    const newMode = args[0]!;
    const modes: Record<string, PermissionMode> = {
      plan: PermissionMode.PLAN,
      default: PermissionMode.DEFAULT,
      acceptEdits: PermissionMode.ACCEPT_EDITS,
      auto: PermissionMode.AUTO,
      dontAsk: PermissionMode.DONT_ASK,
      bypass: PermissionMode.BYPASS,
    };
    if (!modes[newMode]) {
      console.log(`${RED}✗${RESET} Unknown mode: ${newMode}`);
      return;
    }
    // 宽松模式（auto/dontAsk/bypass）需用户主动二次确认：模式切换属于安全敏感动作。
    const LOOSE_MODES = new Set([PermissionMode.AUTO, PermissionMode.DONT_ASK, PermissionMode.BYPASS]);
    if (LOOSE_MODES.has(modes[newMode]!) && this.mode !== modes[newMode]) {
      console.log(`${YELLOW}⚠${RESET}  About to switch mode: ${this.mode} → ${modes[newMode]}`);
      console.log(`${DIM}Loose modes auto-approve many tool actions. Continue? (y/N)${RESET}`);
      const answer = await this.readConfirmationLine();
      if (answer !== 'y' && answer !== 'Y') {
        console.log(`${DIM}Mode change cancelled.${RESET}`);
        return;
      }
    }
    this.mode = modes[newMode]!;
    this.getOrCreateSession().mode = this.mode;
    console.log(`${GREEN}✓${RESET} Mode: ${this.mode}`);
  }

  private handleProviders(args: string[]): void {
    const sub = args[0]?.toLowerCase();
    if (sub === 'presets') {
      console.log(`\n${formatPresetTable()}\n`);
      return;
    }
    if (sub === 'use') {
      const name = args.slice(1).join(' ').trim();
      if (!name) {
        console.log(`${DIM}Usage: /providers use <name>${RESET}`);
        return;
      }
      const p = getCCSwitch().switchTo(name);
      if (!p) {
        console.log(`${RED}Provider not found: ${name}${RESET}`);
        return;
      }
      this.apiKey = p.apiKey;
      this.baseUrl = p.baseUrl;
      if (p.model) this.model = p.model;
      this.engine.setCredentials({
        apiKey: p.apiKey,
        baseUrl: p.baseUrl,
        authStyle: p.authStyle,
        apiProtocol: p.apiProtocol,
      });
      console.log(
        `${GREEN}✓${RESET} Provider: ${p.name}` +
          (p.model ? ` · model ${p.model}` : '') +
          (p.authStyle === 'bearer' ? ' · bearer' : '')
      );
      return;
    }

    console.log('');
    const lines = formatProvidersLines();
    console.log(`${CYAN}${BOLD}${lines[0]}${RESET}`);
    for (const line of lines.slice(1)) {
      console.log(`${DIM}${line}${RESET}`);
    }
    console.log(`${DIM}  /providers use <name> · /providers presets${RESET}`);
    console.log('');
  }

  private showAgents(): void {
    console.log(formatAgentsReport());
  }

  /** C2: 主轮后台任务 — TaskStore 登记 + 完成后一行通知 */
  startBackgroundTurn(prompt: string): string {
    const store = getTaskStore();
    let aborted = false;
    const task = store.begin({
      description: prompt.slice(0, 80),
      subagentType: 'main-btw',
      background: true,
      abort: () => {
        aborted = true;
      },
    });
    const session = this.getOrCreateSession();
    // 快照会话，避免与前台轮次交叉写
    const bgSession: SessionState = {
      ...session,
      sessionId: `${session.sessionId}_btw_${task.id}`,
      messages: [...session.messages],
      toolCallHistory: [...(session.toolCallHistory ?? [])],
    };
    bgSession.messages.push({
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    });

    console.log(
      `${DIM}[bg ${task.id}] started — /agents to list; TaskStop via Task tool${RESET}`
    );

    void (async () => {
      const started = Date.now();
      let text = '';
      let toolCalls = 0;
      let error: string | undefined;
      try {
        for await (const event of this.engine.query(
          {
            message: prompt,
            options: {
              model: this.model,
              maxTokens: effortMaxTokens(session.effort ?? 'medium'),
              systemPrompt: buddySystemHint() ?? undefined,
              shouldAbort: () => aborted || this.exitRequested,
            },
          },
          bgSession
        )) {
          if (aborted || this.exitRequested) break;
          if (event.type === 'content_block_delta' && event.delta?.text) {
            text += event.delta.text;
          } else if (event.type === 'tool_use') {
            toolCalls += 1;
          } else if (event.type === 'error' && event.error) {
            error = event.error.message;
          }
        }
        if (aborted) {
          store.markStopped(task.id);
          process.stdout.write(`\n${DIM}[bg ${task.id}] stopped${RESET}\n`);
          return;
        }
        const success = !error;
        store.complete(task.id, {
          report: {
            agent: 'main-btw',
            success,
            summary: (text || error || 'done').slice(0, 200),
            toolCalls,
            durationMs: Date.now() - started,
            isolation: 'none',
            error,
          },
          output: text,
        });
        const preview = (text || error || 'done').replace(/\s+/g, ' ').slice(0, 80);
        process.stdout.write(
          `\n${DIM}[bg ${task.id}] ${success ? 'done' : 'error'}: ${preview}${RESET}\n`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        store.fail(task.id, msg);
        process.stdout.write(`\n${DIM}[bg ${task.id}] error: ${msg}${RESET}\n`);
      }
    })();

    return task.id;
  }

  private async handlePlan(description: string): Promise<void> {
    const arg = description.trim();
    const planManager = getPlanManager();

    if (!arg) {
      const plan = planManager.getActive();
      if (plan) {
        console.log('');
        console.log(planManager.formatPlanMessage(plan));
        if (plan.status === 'completed' || plan.steps.some((s) => s.status === 'failed')) {
          console.log('');
          console.log(formatPlanExecutionReport(plan));
        }
        console.log('');
        console.log(`${DIM}Status: ${plan.status} | /plan approve | /plan reject | /plan execute | /plan report${RESET}`);
      } else {
        console.log(`${DIM}Usage: /plan <task description>${RESET}`);
        console.log(`${DIM}       /plan approve | reject | execute | list${RESET}`);
        if (this.mode === PermissionMode.PLAN) {
          console.log(`${YELLOW}⚠${RESET}  Plan mode is active. Tools are disabled.`);
        }
      }
      return;
    }

    if (arg === 'list') {
      const plans = planManager.list();
      if (plans.length === 0) {
        console.log(`${DIM}No plans yet.${RESET}`);
        return;
      }
      for (const plan of plans) {
        console.log(`  ${CYAN}${plan.id}${RESET} [${plan.status}] ${plan.title} (${plan.steps.length} steps)`);
      }
      return;
    }

    if (arg === 'report') {
      const plan = planManager.getActive();
      if (!plan) {
        console.log(`${YELLOW}⚠${RESET}  No active plan.`);
        return;
      }
      console.log('');
      console.log(formatPlanExecutionReport(plan));
      console.log('');
      return;
    }

    if (arg === 'approve') {
      const plan = planManager.getActive();
      if (!plan) {
        console.log(`${YELLOW}⚠${RESET}  No active plan. Use /plan <description> first.`);
        return;
      }
      planManager.approve(plan.id);
      console.log(`${GREEN}✓${RESET} Plan approved: ${plan.title}`);
      return;
    }

    if (arg === 'reject') {
      const plan = planManager.getActive();
      if (!plan) {
        console.log(`${YELLOW}⚠${RESET}  No active plan.`);
        return;
      }
      planManager.reject(plan.id);
      console.log(`${YELLOW}✓${RESET} Plan rejected: ${plan.title}`);
      return;
    }

    if (arg === 'execute') {
      const plan = planManager.getActive();
      if (!plan) {
        console.log(`${YELLOW}⚠${RESET}  No active plan. Use /plan <description> first.`);
        return;
      }
      // /plan execute 将模式切到 acceptEdits（后续工具自动批准）。
      // 这是安全敏感动作，必须二次确认。
      console.log(`${YELLOW}⚠${RESET}  /plan execute will switch to acceptEdits mode (auto-approve Edit/Write/Read/Glob/Grep).`);
      console.log(`${DIM}Continue? (y/N)${RESET}`);
      const answer = await this.readConfirmationLine();
      if (answer !== 'y' && answer !== 'Y') {
        console.log(`${DIM}Execution cancelled.${RESET}`);
        return;
      }
      if (plan.status === 'draft') {
        planManager.approve(plan.id);
      }
      const executing = planManager.startExecution(plan.id);
      if (!executing) {
        console.log(`${YELLOW}⚠${RESET}  Plan cannot be executed (status: ${plan.status}).`);
        return;
      }
      this.mode = PermissionMode.ACCEPT_EDITS;
      const session = this.getOrCreateSession();
      session.mode = this.mode;
      console.log(`${GREEN}✓${RESET} Plan executing: ${executing.title}`);
      console.log(planManager.formatPlanMessage(executing));
      console.log(`${DIM}Driving steps via QueryEngine (acceptEdits)...${RESET}`);
      await this.processMessage(formatPlanExecutionKickoff(executing));
      return;
    }

    // 生成新 plan
    if (this.mode !== PermissionMode.PLAN) {
      this.mode = PermissionMode.PLAN;
      const session = this.getOrCreateSession();
      session.mode = this.mode;
      console.log(`${GREEN}✓${RESET} Switched to plan mode (tools disabled)`);
    }

    const planPrompt = `Create a detailed implementation plan for: ${arg}

Format your response EXACTLY as markdown with:
# <Plan Title>

<One paragraph description>

## Steps

1. 🟢 **<action>** _(Read)_ 
   <step description>
2. 🟡 **<action>** _(Edit)_
   <step description>

Use risk icons: 🟢 low, 🟡 medium, 🔴 high. Include tool name in _(ToolName)_ when relevant.`;

    await this.processMessage(planPrompt);

    const session = this.getOrCreateSession();
    const assistantText = extractLastAssistantText(session.messages);
    if (!assistantText) {
      console.log(`${YELLOW}⚠${RESET}  Could not parse plan — no assistant response.`);
      return;
    }

    const parsed = parsePlanFromMarkdown(assistantText, arg);
    const plan = planManager.createPlan(parsed.title, parsed.description, parsed.steps);

    console.log('');
    console.log(`${GREEN}✓${RESET} Plan saved (${plan.id})`);
    console.log('');
    console.log(planManager.formatPlanMessage(plan));
    console.log('');
    console.log(`${DIM}Next: /plan approve → /plan execute${RESET}`);
  }

  private formatToolLabel(tool: ToolCall): string {
    const args = Object.entries(tool.input)
      .map(([k, v]) => {
        const val = typeof v === 'string' ? v : JSON.stringify(v);
        return `${k}=${val.length > 40 ? val.slice(0, 37) + '...' : val}`;
      })
      .join(' ');
    return `${tool.name}(${args})`;
  }

  private summarizeForTranscript(tool: ToolCall, result: ToolResult): string {
    const text =
      result.content[0]?.type === 'text' ? result.content[0].text : '';
    if (result.isError) return text.slice(0, 200);
    if (tool.name === 'Read') return `${text.split('\n').length} lines`;
    if (tool.name === 'Glob') return `${text.split('\n').filter(Boolean).length} paths`;
    return text.slice(0, 300);
  }

  private dumpTranscript(buffer: TranscriptBuffer): void {
    const wasExpanded = buffer.expanded;
    buffer.toggleExpand();
    if (wasExpanded) return;
    process.stdout.write(`\n${DIM}── transcript ──${RESET}\n`);
    for (const entry of buffer.entries) {
      renderer.renderTranscriptEntry(entry.label, entry.detail);
    }
    process.stdout.write(`${DIM}── end transcript ──${RESET}\n`);
  }

  private async processMessage(message: string, images: ImageSource[] = []): Promise<void> {
    const session = this.getOrCreateSession();
    // K4: 到期 cron 先注入，再处理当前用户消息
    this.drainCronDue(session);
    session.messages.push({
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });

    const startTime = Date.now();
    let modelToolCount = 0;
    let turnOutputTokens = 0;
    const prefetchTools: ToolCall[] = [];
    let thoughtPrinted = false;
    let agentsBlockPrinted = false;
    const transcript = new TranscriptBuffer();
    this.queryTranscript = transcript;
    const progress = new QueryProgressLine();
    const liveTasks = new LiveTaskPanel();
    const toolRunning = new ToolRunningLine();
    this.isProcessing = true;
    this.interruptRequested = false;
    this.inputEditor?.pause();

    progress.startThinking();
    this.streamWriter.reset();

    const stopProgress = (): void => {
      if (!thoughtPrinted) {
        const elapsed = progress.stop();
        progress.renderThoughtSummary(elapsed);
        thoughtPrinted = true;
      }
    };

    const syncLiveTasks = (): void => {
      const items = todosToPanelItems(getTodoStore().list(session.sessionId));
      if (items.length === 0) {
        liveTasks.clear();
        return;
      }
      stopProgress();
      progress.suspend();
      liveTasks.setOutputTokens(turnOutputTokens);
      liveTasks.sync(items);
    };

    try {
      for await (const event of this.engine.query(
        {
          message,
          images: images.length > 0 ? images : undefined,
          options: {
            model: this.model,
            maxTokens: effortMaxTokens(session.effort ?? 'medium'),
            systemPrompt: buddySystemHint() ?? undefined,
            shouldAbort: () => this.interruptRequested || this.exitRequested,
          },
        },
        session
      )) {
        if (this.interruptRequested || this.exitRequested) break;

        switch (event.type) {
          case 'skill_loaded':
            if (event.skills && event.skills.length > 0) {
              stopProgress();
              liveTasks.invalidate();
              renderer.renderSkillLoaded(event.skills);
              for (const name of event.skills) {
                transcript.add({ kind: 'skill', label: `Skill ${name}` });
              }
            }
            break;
          case 'agents_running':
            if (event.parallelAgents && event.parallelAgents.length > 0) {
              stopProgress();
              progress.suspend();
              liveTasks.invalidate();
              agentsBlockPrinted = true;
              renderer.renderParallelAgents(event.parallelAgents, {
                elapsedSec: progress.elapsedSeconds(),
              });
              transcript.add({
                kind: 'prefetch',
                label: `Running ${event.parallelAgents.length} explore subagents (LLM)`,
              });
            }
            break;
          case 'agent_progress':
            if (event.parallelAgents && event.tool && !agentsBlockPrinted) {
              progress.setPrefetchPhase(this.formatToolLabel(event.tool));
            }
            break;
          case 'agents_complete':
            if (event.parallelAgents && event.parallelAgents.length > 0) {
              progress.suspend();
              liveTasks.invalidate();
              // 补画 ■ 完成态，避免只留下启动时的空 □
              renderer.renderParallelAgents(event.parallelAgents, {
                elapsedSec: progress.elapsedSeconds(),
              });
            }
            if (prefetchTools.length > 0) {
              renderer.renderCompactToolActivity(prefetchTools, {
                hiddenCount: transcript.hiddenCount(),
              });
            }
            break;
          case 'prefetch_progress':
            if (event.tool && event.result) {
              prefetchTools.push(event.tool);
              if (!agentsBlockPrinted) {
                progress.setPrefetchPhase(this.formatToolLabel(event.tool));
              }
              transcript.add({
                kind: 'prefetch',
                label: this.formatToolLabel(event.tool),
                detail: this.summarizeForTranscript(event.tool, event.result),
              });
            }
            break;
          case 'content_block_delta':
            if (event.delta) {
              stopProgress();
              liveTasks.invalidate();
              toolRunning.stop();
              const formatted = this.streamWriter.append(event.delta.text);
              if (formatted) process.stdout.write(formatted);
            }
            break;
          case 'prefetch_complete':
            if (event.prefetchTools && event.prefetchTools.length > 0) {
              stopProgress();
              liveTasks.invalidate();
              for (const t of event.prefetchTools) {
                if (!prefetchTools.some((p) => p.id === t.id)) {
                  prefetchTools.push(t);
                }
              }
              if (!agentsBlockPrinted) {
                renderer.renderCompactToolActivity(event.prefetchTools, {
                  hiddenCount: transcript.hiddenCount(),
                });
              }
            }
            break;
          case 'tool_use':
            if (event.tool) {
              progress.setToolPhase(this.formatToolLabel(event.tool));
              stopProgress();
              toolRunning.stop();
              liveTasks.invalidate();
              modelToolCount++;
              renderer.renderToolUse(event.tool);
              transcript.add({
                kind: 'tool_use',
                label: this.formatToolLabel(event.tool),
              });
              // Bash / 长工具：显示 Running… 计时行
              if (isLongRunningTool(event.tool.name) && event.tool.name !== 'TodoWrite') {
                const timeoutMs =
                  typeof event.tool.input?.timeout === 'number'
                    ? event.tool.input.timeout
                    : 60_000;
                toolRunning.start({
                  timeoutMs,
                  backgroundHint: event.tool.name === 'Bash',
                });
              }
            }
            break;
          case 'tool_result':
            if (event.tool && event.result) {
              toolRunning.stop();
              liveTasks.invalidate();
              // TodoWrite：刷新任务树，跳过冗长 ↳（列表已在面板）
              if (event.tool.name === 'TodoWrite' && !event.result.isError) {
                syncLiveTasks();
                transcript.add({
                  kind: 'tool_result',
                  label: this.formatToolLabel(event.tool),
                  detail: 'task list updated',
                });
              } else {
                renderer.renderToolResult(event.tool, event.result);
                transcript.add({
                  kind: 'tool_result',
                  label: this.formatToolLabel(event.tool),
                  detail: this.summarizeForTranscript(event.tool, event.result),
                });
                // 非 TodoWrite 工具后若仍有任务，把面板画在底部
                if (liveTasks.hasTasks) {
                  syncLiveTasks();
                }
              }
            }
            break;
          case 'message_stop': {
            const tail = this.streamWriter.flush();
            if (tail) process.stdout.write(tail);
            if (event.usage) {
              this.tokenUsage.input += event.usage.inputTokens ?? 0;
              this.tokenUsage.output += event.usage.outputTokens ?? 0;
              turnOutputTokens = event.usage.outputTokens ?? 0;
              progress.setOutputTokens(turnOutputTokens);
              liveTasks.setOutputTokens(turnOutputTokens);
            }
            break;
          }
          case 'error':
            if (event.error) {
              stopProgress();
              toolRunning.stop();
              liveTasks.invalidate();
              console.log(`\n${RED}⏺ Error: ${event.error.message}${RESET}`);
            }
            break;
        }
      }

      toolRunning.stop();
      liveTasks.stop();
      stopProgress();

      const timeline = progress.formatTimelineSummary();
      if (timeline) {
        console.log(`${DIM}${timeline}${RESET}`);
      }

      if (this.interruptRequested) {
        console.log(`${DIM}· Interrupted${RESET}\n`);
        return;
      }

      console.log('');

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const tokenMeta =
        turnOutputTokens > 0 || modelToolCount > 0
          ? `${DIM}(${elapsed}s${modelToolCount > 0 ? ` · ${modelToolCount} tools` : ''}${
              turnOutputTokens > 0 ? ` · ↓ ${turnOutputTokens} tokens` : ''
            })${RESET}`
          : `${DIM}(${elapsed}s)${RESET}`;
      console.log(`${tokenMeta}\n`);

      this.sessionManager.saveSession(session);
    } catch (error) {
      toolRunning.stop();
      liveTasks.stop();
      progress.stop();
      console.log(
        `\n${RED}⏺ Error: ${error instanceof Error ? error.message : String(error)}${RESET}\n`
      );
    } finally {
      toolRunning.stop();
      liveTasks.stop();
      this.isProcessing = false;
      this.interruptRequested = false;
      this.queryTranscript = null;
      getAgentPool().clear();
      // H3: Stop hook — fires every time the agent loop ends
      // (normal end_turn, max_turns, abort, error). User-configured
      // hooks can clean up, log, or trigger follow-up work.
      try {
        await runStopHooks(this.hookRegistry, session);
      } catch (e) {
        // Never let hook errors escape this finally block
      }
      if (!this.exitRequested) {
        this.inputEditor?.resume();
      }
    }
  }

  /** AskUser 读行：editor 已 pause，stdin 为 cooked；轮询 interruptRequested */
  private readAskUserLine(prompt: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      let settled = false;
      const cleanup = (): void => {
        clearInterval(poll);
        rl.close();
      };
      const finish = (value: string): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const abort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new AskUserAbortedError());
      };
      rl.on('SIGINT', abort);
      const poll = setInterval(() => {
        if (this.interruptRequested || this.exitRequested) abort();
      }, 100);
      rl.question(prompt, (answer) => finish(answer));
    });
  }

  private async promptForPermission(
    tool: ToolCall,
    batchTools?: ToolCall[]
  ): Promise<boolean> {
    // 保持 inputEditor pause：绝不用 readLine 抢 raw mode（否则确认框像卡死）
    if (batchTools && batchTools.length > 1) {
      const lines: string[] = [];
      const seen = new Set<string>();
      for (const t of batchTools) {
        if (seen.has(t.name)) continue;
        seen.add(t.name);
        const count = batchTools.filter((x) => x.name === t.name).length;
        const label = count > 1 ? `${t.name} ×${count}` : t.name;
        const a = summarizeToolAction(t);
        const p = a.length > 64 ? `${a.slice(0, 61)}…` : a;
        lines.push(`${label}  ${p}`);
      }
      return confirmYesNo({
        title: `Allow ${batchTools.length} tools that need confirmation?`,
        lines,
        defaultYes: true,
        shouldAbort: () => this.interruptRequested || this.exitRequested,
      });
    }

    const action = summarizeToolAction(tool);
    const preview = action.length > 72 ? `${action.slice(0, 69)}…` : action;
    return confirmYesNo({
      title: `Allow ${tool.name}`,
      lines: [preview],
      defaultYes: true,
      shouldAbort: () => this.interruptRequested || this.exitRequested,
    });
  }

  private getOrCreateSession() {
    const existing = this.sessionManager.getCurrentSession();
    if (existing) {
      existing.mode = this.mode;
      return existing;
    }
    return this.sessionManager.createSession({ mode: this.mode });
  }

  /** K6: 本地健康检查 */
  private handleDoctor(): void {
    const report = formatDoctorReport(
      runDoctorChecks({
        cwd: process.cwd(),
        hasApiKey: Boolean(this.apiKey),
        model: this.model,
        mode: this.mode,
        mcpConnected: this.mcpConnections.filter((c) => c.status === 'connected').length,
        mcpTools: this.mcpConnections.reduce((n, c) => n + (c.tools?.length ?? 0), 0),
        skillsCount: this.skillsLoader.list().length,
      })
    );
    console.log('');
    console.log(report);
    console.log('');
  }

  /** K6: 只读 git diff 视图 */
  private handleDiff(): void {
    console.log('');
    console.log(formatGitDiffView(process.cwd()));
    console.log('');
  }

  /** K5: Bridge 状态（会话 deferred；远程 MCP 清单 partial） */
  private handleBridge(args: string[] = []): void {
    const sessionReq = parseBridgeSessionArgs(args);
    if (sessionReq) {
      console.log('');
      console.log(formatBridgeSessionOp(bridgeSessionOp(sessionReq)));
      console.log('');
      return;
    }
    const connections = this.mcpConnections.length
      ? this.mcpConnections
      : getMCPClient().listConnections();
    console.log('');
    console.log(formatBridgeStatus(getBridgeStatus({ connections })));
    console.log('');
  }

  /** Voice STT: start|stop|status|buddy */
  private handleVoice(args: string[] = []): void {
    const sub = (args[0] ?? 'status').toLowerCase();
    console.log('');
    if (sub === 'start') {
      console.log(formatVoiceStatus(startVoiceListening()));
    } else if (sub === 'stop') {
      console.log(formatVoiceStatus(stopVoiceListening()));
    } else if (sub === 'buddy') {
      const on = (args[1] ?? 'on').toLowerCase();
      setBuddyNarration(on !== 'off' && on !== '0' && on !== 'false');
      console.log(formatVoiceStatus(getVoiceStatus()));
    } else {
      console.log(formatVoiceStatus(getVoiceStatus()));
    }
    console.log('');
  }

  /** K4: 进程内 cron 管理（无 OS daemon） */
  private handleCron(args: string[]): void {
    const lines = formatCronLines(args);
    console.log('');
    for (const line of lines) {
      console.log(line);
    }
    console.log('');
  }

  private drainCronDue(session: SessionState): void {
    try {
      const due = getCronStore().due().slice(0, MAX_CRON_DUE_PER_TURN);
      for (const job of due) {
        const body = sanitizeCronPrompt(job.prompt);
        session.messages.push({
          role: 'user',
          content:
            `[ScheduledCron ${job.id}]\n` +
            `--- cron prompt (untrusted scheduled text) ---\n${body}\n` +
            `--- end cron ---`,
          timestamp: Date.now(),
        });
      }
      if (due.length > 0) {
        console.log(`${DIM}⏱ Injected ${due.length} due cron job(s)${RESET}`);
      }
    } catch {
      /* cron store optional */
    }
  }

  /** K3: 确定性项目 Brief（非核心工具；SkillTool("brief") 为文档入口） */
  private handleBrief(): void {
    const brief = buildProjectBrief(process.cwd());
    const text = formatProjectBrief(brief);
    console.log('');
    console.log(text);
    console.log(`${DIM}Tip: SkillTool name=brief loads the Brief skill workflow.${RESET}`);
    console.log('');

    const session = this.sessionManager.getCurrentSession();
    if (session) {
      session.messages.push({
        role: 'user',
        content: `[Project Brief — deterministic /brief]\n\n${text}`,
        timestamp: Date.now(),
      });
    }
  }

  /** I5: /style <name> — switch REPL output style (default/cost/full/minimal). */
  private handleStyle(args: string[]): void {
    if (args.length === 0) {
      console.log(`${CYAN}${BOLD}Output styles${RESET}`);
      for (const s of listStyles()) {
        const opts = getStyleOptions(s);
        const active = this.outputStyle === s ? ' *' : '  ';
        console.log(
          `  ${active}${BOLD}${s}${RESET}  ${DIM}cost=${opts.showCost ? 'on' : 'off'} tool=${opts.showToolActivity ? 'on' : 'off'} prefetch=${opts.showPrefetch ? 'on' : 'off'}${RESET}`
        );
      }
      return;
    }
    const name = args[0]!;
    if (!listStyles().includes(name as never)) {
      console.log(`${YELLOW}?${RESET} Unknown style: ${name}. Try one of: ${listStyles().join(', ')}`);
      return;
    }
    this.outputStyle = name as never;
    console.log(`${GREEN}✓${RESET} Output style: ${BOLD}${name}${RESET}`);
  }

  /** I2: /rewind — list checkpoints or roll back to a given one. */
  private async handleRewind(args: string[]): Promise<void> {
    const { listCheckpoints, rewindToDetailed, formatCheckpointList } = await import(
      '../services/checkpoint.js'
    );
    if (args.length === 0) {
      console.log(formatCheckpointList(listCheckpoints()));
      return;
    }
    const id = args[0]!;
    const result = rewindToDetailed(id);
    if (result.ok) {
      console.log(`${GREEN}✓${RESET} Rewound to ${DIM}${id}${RESET}`);
    } else {
      console.log(`${YELLOW}?${RESET} ${result.message}`);
    }
  }

  /**
   * H8: Resume a saved session. /resume lists candidates;
   * /resume <id> loads that session into the current REPL.
   * Failure paths return isError-shaped output so the caller
   * sees a clear message; nothing is mutated on failure.
   */
  private async handleResume(args: string[]): Promise<void> {
    const resume = getSessionResume();
    if (args.length === 0) {
      for (const line of formatResumeListLines(resume)) {
        console.log(line);
      }
      return;
    }

    const loaded = loadResumeSession(args[0]!, resume);
    if (!loaded.ok) {
      for (const line of loaded.lines) {
        console.log(`${YELLOW}?${RESET} ${line}`);
      }
      return;
    }

    this.sessionManager.restoreSession(loaded.state);
    this.mode = loaded.state.mode;
    console.log(`${GREEN}✓${RESET} ${formatResumeSuccess(loaded.state)}`);
  }
}

export interface REPLOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  mode: PermissionMode;
  provider: Provider;
  authStyle?: import('../pkg/anthropic-client.js').ProviderAuthStyle;
  apiProtocol?: import('../pkg/ccswitch/presets.js').ProviderApiProtocol;
  sessionManager?: SessionManager;
  toolRegistry?: ToolRegistry;
  hookRegistry?: HookRegistry;
  initialSession?: SessionState;
  /** 测试注入 mock QueryEngine */
  engine?: QueryEngine;
}

export type SlashPeekResult =
  | { kind: 'custom'; prompt: string }
  | { kind: 'plugin'; name: string; prompt: string }
  | { kind: 'builtin'; command: string };
