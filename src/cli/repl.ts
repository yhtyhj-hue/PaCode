/**
 * REPL - Interactive Chat Mode
 *
 * Continuous conversation like Claude Code CLI.
 * Implements core Claude Code slash commands.
 */

import { createInterface, Interface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryEngine } from '../agent/engine.js';
import { SessionManager } from '../session/manager.js';
import { getToolRegistry, ToolRegistry } from '../tools/registry.js';
import { registerCoreTools } from '../tools/bootstrap.js';
import { bootstrapMcpTools } from '../mcp/loader.js';
import { getMCPClient } from '../mcp/client.js';
import { bootstrapHooks, runSessionHooks } from '../hooks/loader.js';
import { bootstrapPlugins, PluginCommand } from '../plugins/bootstrap.js';
import { HookRegistry } from '../hooks/registry.js';
import { compactSession } from '../context/session-compactor.js';
import { PermissionMode, MCPServerConnection, SessionState, HookType } from '../pkg/types.js';
import { Provider } from '../pkg/ccswitch/index.js';
import { CCSwitchClient } from '../pkg/ccswitch/index.js';
import { SkillsLoader } from '../skills/loader.js';
import { getSubagentManager } from '../agent/subagent.js';
import { getPlanManager } from '../agent/plan-mode.js';
import { parsePlanFromMarkdown, extractLastAssistantText } from '../agent/plan-parser.js';
import { ContextAssembler } from '../context/assembler.js';
import { renderer } from './enhanced-renderer.js';
import { StreamingMarkdownWriter, summarizeToolAction } from './streaming-markdown.js';
import { ToolCall } from '../pkg/types.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';

export class REPL {
  private rl: Interface | null = null;
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

  constructor(options: REPLOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.mode = options.mode;
    this.provider = options.provider;
    this.sessionManager = options.sessionManager ?? new SessionManager();
    this.toolRegistry = options.toolRegistry ?? getToolRegistry();
    this.hookRegistry = options.hookRegistry ?? new HookRegistry();

    const taskDeps = {
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      model: this.model,
      toolRegistry: this.toolRegistry,
    };
    registerCoreTools(this.toolRegistry, { task: taskDeps });
    bootstrapHooks(this.hookRegistry);

    this.skillsLoader = new SkillsLoader();

    this.engine = new QueryEngine({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      toolRegistry: this.toolRegistry,
      sessionManager: this.sessionManager,
      hookRegistry: this.hookRegistry,
      contextAssembler: new ContextAssembler({ skillsLoader: this.skillsLoader }),
      permissionPrompt: async (tool) => this.promptForPermission(tool),
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

    // Disable readline's default prompt - we draw our own
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '',
    });

    // Draw initial UI: top border + prompt + status bar
    this.drawInputUI();
    // Use readline's prompt() to actually wait for input
    this.rl.prompt();

    this.setupKeyHandlers();

    this.rl.on('line', (input) => {
      const trimmed = input.trim();

      if (this.exitRequested || !this.rl) {
        this.rl?.close();
        return;
      }

      if (trimmed.startsWith('/')) {
        this.dispatchSlashCommand(trimmed).then(() => {
          if (this.exitRequested || !this.rl) {
            this.rl?.close();
          } else {
            this.drawInputUI();
          }
        });
        return;
      }

      if (!trimmed) {
        this.drawInputUI();
        return;
      }

      if (trimmed === 'exit' || trimmed === 'quit') {
        this.exitRequested = true;
        this.rl.close();
        return;
      }

      this.processMessage(trimmed).then(() => {
        if (this.exitRequested) {
          this.rl?.close();
        } else {
          this.drawInputUI();
        }
      });
    });

    this.rl.on('close', () => {
      this.printGoodbye();
      process.exit(0);
    });
  }

  private drawInputUI(): void {
    // Claude Code style: top border + prompt with cursor + status bar
    const width = 120;
    const border = '-'.repeat(width);
    process.stdout.write(`${DIM}${border}${RESET}\r\n`);

    // Prompt with cursor (using simple > instead of ❯ for compat)
    process.stdout.write(`${CYAN}${BOLD}> ${RESET}`);

    // Status bar below
    this.drawStatusBar();
  }

  private setupKeyHandlers(): void {
    if (!this.rl) return;
    const stdin = process.stdin as NodeJS.ReadStream & {
      emit: (event: string, ...args: unknown[]) => boolean;
    };

    // Ctrl+C - interrupt/cancel
    stdin.on('keypress', (_str: string, key: { ctrl?: boolean; name?: string }) => {
      if (key?.ctrl && key.name === 'c') {
        // Just clear input for now (processMessage handles actual interrupt)
        if (this.rl) {
          this.rl.write('', { ctrl: true, name: 'u' });
        }
      }

      // Ctrl+D - exit
      if (key?.ctrl && key.name === 'd') {
        this.exitRequested = true;
        this.rl?.close();
      }

      // Shift+Tab - cycle permission mode
      // Note: Shift+Tab is hard to detect in standard readline,
      // so we expose /mode for now
    });
  }

  private printWelcome(): void {
    console.log('');
    console.log(
      `${CYAN}${BOLD}  💬 Interactive Mode${RESET} ${DIM}- Type your message and press Enter${RESET}`
    );
    console.log(`${DIM}  Commands: /help for all commands | /exit to quit${RESET}`);
    console.log('');
  }

  private printGoodbye(): void {
    const session = this.sessionManager.getCurrentSession();
    if (session) {
      void runSessionHooks(this.hookRegistry, HookType.SESSION_STOP, session);
      this.sessionManager.saveSession(session);
    }

    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    console.log('');
    console.log(
      `${GREEN}✓${RESET} Session ended. Duration: ${elapsed}s | Tokens: ${this.tokenUsage.input + this.tokenUsage.output}`
    );
    console.log('');
  }

  private drawStatusBar(): void {
    const width = 120;
    const modeLabel = this.mode === PermissionMode.DEFAULT ? 'normal' : this.mode;
    const leftText = `⏵⏵ ${modeLabel} mode · shift+tab to cycle · esc to interrupt · ctrl+c cancel · ctrl+d exit`;

    // Calculate approximate context usage based on token count
    const tokenCount = this.tokenUsage.input + this.tokenUsage.output;
    const maxContext = 200000; // 200K context window
    const usagePercent = Math.min(100, Math.round((tokenCount / maxContext) * 100));
    const contextText = tokenCount > 0 ? `${usagePercent}% context used` : '0% context used';

    const rightText = `${contextText} · /model ${this.model} · /help`;

    const pad = width - leftText.length - rightText.length;
    const padding = ' '.repeat(Math.max(2, pad));
    console.log(`${DIM}${leftText}${padding}${rightText}${RESET}`);
  }

  /** 解析 slash 输入，不执行（供测试与 dispatch 共用） */
  peekSlashCommand(trimmed: string): SlashPeekResult | null {
    if (!trimmed.startsWith('/')) return null;

    const cmdName = trimmed.split(/\s+/)[0]!.slice(1);
    const arg = trimmed.includes(' ') ? trimmed.slice(trimmed.indexOf(' ') + 1).trim() : '';

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
      case '/model':
        this.handleModel(args);
        break;
      case '/mode':
        this.handleMode(args);
        break;
      case '/agents':
        this.showAgents();
        break;
      case '/plan':
        await this.handlePlan(arg);
        break;
      case '/providers':
        this.showProviders();
        break;
      case '/effort':
        console.log(`${DIM}Effort level: default${RESET}`);
        break;
      case '/vim':
        console.log(`${DIM}Vim mode: off${RESET}`);
        break;
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
        ['/clear', 'Clear conversation history'],
        ['/compact', 'Compress conversation to reduce tokens'],
        ['/context', 'Show context usage'],
        ['/exit', 'Exit REPL'],
      ],
      Information: [
        ['/status', 'Show session info'],
        ['/cost', 'Show token usage and cost'],
        ['/memory', 'Show memory file locations'],
        ['/mcp', 'Show MCP server connections'],
        ['/permissions', 'Show permission rules'],
        ['/providers', 'List API providers'],
      ],
      Configuration: [
        ['/mode [name]', 'Change permission mode'],
        ['/model [name]', 'Show or change model'],
        ['/effort', 'Show effort level'],
        ['/vim', 'Toggle vim mode'],
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
    console.log(`${GREEN}✓${RESET} Conversation cleared`);
  }

  private async compact(instructions: string): Promise<void> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      console.log(`${YELLOW}⚠${RESET}  No active session to compact`);
      return;
    }

    if (session.messages.length <= 4) {
      console.log(`${YELLOW}⚠${RESET}  Not enough messages to compact (${session.messages.length})`);
      return;
    }

    console.log(`${DIM}⏺ Compacting conversation...${RESET}`);

    try {
      const result = await compactSession(session, {
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        model: this.model,
        instructions: instructions.trim() || undefined,
      });

      this.sessionManager.saveSession(result.session);
      console.log(
        `${GREEN}✓${RESET} Compacted ${result.beforeCount} → ${result.afterCount} messages`
      );
      if (result.summary) {
        const preview = result.summary.split('\n')[0]?.slice(0, 80) ?? '';
        console.log(`${DIM}  Summary: ${preview}${result.summary.length > 80 ? '...' : ''}${RESET}`);
      }
    } catch (error) {
      console.log(
        `${RED}✗${RESET} Compaction failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private showContext(): void {
    console.log('');
    console.log(`${CYAN}${BOLD}Context Usage${RESET}`);
    const session = this.sessionManager.getCurrentSession();
    const msgCount = session?.messages.length ?? 0;
    console.log(`  ${DIM}Messages:${RESET}   ${msgCount}`);
    console.log(`  ${DIM}Tokens:${RESET}     ${this.tokenUsage.input + this.tokenUsage.output}`);
    console.log('');
  }

  private showCost(): void {
    console.log('');
    console.log(`${CYAN}${BOLD}Token Usage${RESET}`);
    console.log(`  ${DIM}Input:${RESET}   ${this.tokenUsage.input}`);
    console.log(`  ${DIM}Output:${RESET}  ${this.tokenUsage.output}`);
    console.log(`  ${DIM}Total:${RESET}   ${this.tokenUsage.input + this.tokenUsage.output}`);
    // Rough cost estimate: $3/M input, $15/M output
    const cost = (this.tokenUsage.input * 3 + this.tokenUsage.output * 15) / 1_000_000;
    console.log(`  ${DIM}Est. cost:${RESET} $${cost.toFixed(4)}`);
    console.log('');
  }

  private showMemory(): void {
    console.log('');
    console.log(`${CYAN}${BOLD}Memory Locations${RESET}`);
    console.log(`  ${DIM}User memory:${RESET}    ~/.paude/memory/`);
    console.log(`  ${DIM}Project memory:${RESET} .paude/projects/{hash}/`);
    console.log(`  ${DIM}Session memory:${RESET} ~/.paude/sessions/`);
    console.log('');
  }

  private async initProject(): Promise<void> {
    const claudeMdPath = join(process.cwd(), 'CLAUDE.md');
    if (existsSync(claudeMdPath)) {
      console.log(`${YELLOW}⚠${RESET}  CLAUDE.md already exists at ${claudeMdPath}`);
      return;
    }

    const template = `# CLAUDE.md

Project-specific instructions for PaCode/Claude Code.

## Project Overview

[Briefly describe your project here]

## Architecture

[Describe the high-level architecture]

## Key Files

- [\`src/\`](src/) - Source code
- [\`docs/\`](docs/) - Documentation
- [\`tests/\`](tests/) - Test files

## Development Workflow

1. Read the relevant code first
2. Make focused changes
3. Run tests before committing
4. Update documentation if needed

## Conventions

- Use TypeScript for all new code
- Follow existing code style
- Write tests for new features
- Update CLAUDE.md when patterns change
`;
    try {
      writeFileSync(claudeMdPath, template, 'utf-8');
      console.log(`${GREEN}✓${RESET} Created CLAUDE.md at ${claudeMdPath}`);
    } catch (e) {
      console.log(`${RED}✗${RESET} Failed to create CLAUDE.md: ${e}`);
    }
  }

  private showMcp(): void {
    console.log('');
    console.log(`${CYAN}${BOLD}MCP Servers${RESET}`);
    const connections = this.mcpConnections.length
      ? this.mcpConnections
      : getMCPClient().listConnections();

    if (connections.length === 0) {
      console.log(`  ${DIM}No MCP servers connected${RESET}`);
      console.log(`  ${DIM}Configure with: pacode mcp add <name> <command>${RESET}`);
    } else {
      for (const conn of connections) {
        const status =
          conn.status === 'connected' ? `${GREEN}connected${RESET}` : `${YELLOW}${conn.status}${RESET}`;
        console.log(
          `  ${CYAN}${conn.name}${RESET} · ${status} · ${conn.tools.length} tool(s)`
        );
        if (conn.lastError) {
          console.log(`    ${DIM}Error: ${conn.lastError}${RESET}`);
        }
      }
    }
    console.log('');
  }

  private showPermissions(): void {
    console.log('');
    console.log(`${CYAN}${BOLD}Permission Rules${RESET}`);
    console.log(`  ${DIM}Current mode: ${this.mode}${RESET}`);
    console.log(`  ${DIM}Configure with: /mode <name>${RESET}`);
    console.log('');
  }

  private handleModel(args: string[]): void {
    if (args.length === 0) {
      console.log(`${DIM}Current model:${RESET} ${this.model}`);
      console.log(`${DIM}Available models depend on your provider${RESET}`);
      return;
    }
    this.model = args.join(' ');
    console.log(`${GREEN}✓${RESET} Model: ${this.model}`);
  }

  private handleMode(args: string[]): void {
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
    if (modes[newMode]) {
      this.mode = modes[newMode]!;
      console.log(`${GREEN}✓${RESET} Mode: ${this.mode}`);
    } else {
      console.log(`${RED}✗${RESET} Unknown mode: ${newMode}`);
    }
  }

  private showProviders(): void {
    const cc = new CCSwitchClient();
    const providers = cc.list();
    if (providers.length === 0) {
      console.log(`${DIM}No providers configured${RESET}`);
      return;
    }
    const active = cc.getActive();
    console.log('');
    console.log(`${CYAN}${BOLD}API Providers${RESET}`);
    for (const p of providers) {
      const marker = active?.name === p.name ? `${GREEN}●${RESET}` : `${GRAY}○${RESET}`;
      console.log(`  ${marker} ${p.name}${p.model ? ` (${p.model})` : ''}`);
    }
    console.log('');
  }

  private showAgents(): void {
    const agents = getSubagentManager().list();
    console.log('');
    console.log(`${CYAN}${BOLD}Available Subagents${RESET}`);
    for (const agent of agents) {
      console.log(`  ${CYAN}${agent.name}${RESET}`);
      console.log(`    ${DIM}${agent.description}${RESET}`);
      if (agent.tools && agent.tools.length > 0) {
        console.log(`    ${DIM}Tools: ${agent.tools.join(', ')}${RESET}`);
      }
    }
    console.log('');
  }

  private async handlePlan(description: string): Promise<void> {
    const arg = description.trim();
    const planManager = getPlanManager();

    if (!arg) {
      const plan = planManager.getActive();
      if (plan) {
        console.log('');
        console.log(planManager.formatPlanMessage(plan));
        console.log('');
        console.log(`${DIM}Status: ${plan.status} | /plan approve | /plan reject | /plan execute${RESET}`);
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
      console.log(`${GREEN}✓${RESET} Executing plan: ${executing.title}`);
      console.log(`${DIM}Switched to acceptEdits mode. Describe which step to run, or paste the plan.${RESET}`);
      console.log('');
      console.log(planManager.formatPlanMessage(executing));
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

  private async processMessage(message: string): Promise<void> {
    console.log('');
    console.log(
      `${CYAN}${BOLD}>${RESET} ${message.split('\n')[0]}${message.includes('\n') ? '...' : ''}`
    );
    console.log('');

    const session = this.getOrCreateSession();
    session.messages.push({
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });

    const startTime = Date.now();
    let toolCallCount = 0;

    // Spinner frames
    const spinnerFrames = [
      '⏺ Pontificating   ',
      '⏺ Pontificating.  ',
      '⏺ Pontificating.. ',
      '⏺ Pontificating...',
    ];
    let spinnerIdx = 0;
    let spinnerInterval: ReturnType<typeof setInterval> | null = null;

    // Start animated spinner
    process.stdout.write(`${DIM}${spinnerFrames[0]}${RESET}\r`);
    spinnerInterval = setInterval(() => {
      spinnerIdx = (spinnerIdx + 1) % spinnerFrames.length;
      process.stdout.write(`\r${DIM}${spinnerFrames[spinnerIdx]}${RESET}  `);
    }, 100);

    this.streamWriter.reset();

    try {
      for await (const event of this.engine.query(
        { message, options: { model: this.model } },
        session
      )) {
        switch (event.type) {
          case 'content_block_delta':
            if (event.delta) {
              if (spinnerInterval) {
                clearInterval(spinnerInterval);
                spinnerInterval = null;
                process.stdout.write('\r' + ' '.repeat(40) + '\r');
              }
              const formatted = this.streamWriter.append(event.delta.text);
              if (formatted) process.stdout.write(formatted);
            }
            break;
          case 'tool_use':
            if (event.tool) {
              toolCallCount++;
              console.log('');
              renderer.renderToolUse(event.tool);
            }
            break;
          case 'tool_result':
            if (event.result) {
              renderer.renderToolResult(event.result);
            }
            break;
          case 'message_stop': {
            const tail = this.streamWriter.flush();
            if (tail) process.stdout.write(tail);
            if (event.usage) {
              this.tokenUsage.input += event.usage.inputTokens ?? 0;
              this.tokenUsage.output += event.usage.outputTokens ?? 0;
            }
            break;
          }
          case 'error':
            if (event.error) {
              if (spinnerInterval) {
                clearInterval(spinnerInterval);
                spinnerInterval = null;
                process.stdout.write('\r' + ' '.repeat(40) + '\r');
              }
              console.log(`\n${RED}⏺ Error: ${event.error.message}${RESET}`);
            }
            break;
        }
      }

      // Clear spinner if still running
      if (spinnerInterval) {
        clearInterval(spinnerInterval);
        process.stdout.write('\r' + ' '.repeat(40) + '\r');
      }
      console.log('');

      // Show completion status bar (Claude Code style)
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const totalTokens = this.tokenUsage.input + this.tokenUsage.output;
      console.log(
        `${DIM}· Done (${elapsed}s · ↑ ${totalTokens} tokens${toolCallCount > 0 ? ` · ${toolCallCount} tools used` : ''})${RESET}\n`
      );

      this.sessionManager.saveSession(session);
    } catch (error) {
      if (spinnerInterval) {
        clearInterval(spinnerInterval);
        process.stdout.write('\r' + ' '.repeat(40) + '\r');
      }
      console.log(
        `\n${RED}⏺ Error: ${error instanceof Error ? error.message : String(error)}${RESET}\n`
      );
    }
  }

  private async promptForPermission(tool: ToolCall): Promise<boolean> {
    if (!process.stdin.isTTY) return true;

    if (this.rl) this.rl.pause();
    try {
      return await renderer.renderPermissionPrompt(tool.name, summarizeToolAction(tool));
    } finally {
      if (this.rl && !this.exitRequested) {
        this.rl.resume();
      }
    }
  }

  private getOrCreateSession() {
    const existing = this.sessionManager.getCurrentSession();
    if (existing) {
      existing.mode = this.mode;
      return existing;
    }
    return this.sessionManager.createSession({ mode: this.mode });
  }
}

export interface REPLOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  mode: PermissionMode;
  provider: Provider;
  sessionManager?: SessionManager;
  toolRegistry?: ToolRegistry;
  hookRegistry?: HookRegistry;
  initialSession?: SessionState;
}

export type SlashPeekResult =
  | { kind: 'custom'; prompt: string }
  | { kind: 'plugin'; name: string; prompt: string }
  | { kind: 'builtin'; command: string };
