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
import { getToolRegistry } from '../tools/registry.js';
import { registerBashTool } from '../tools/bash.js';
import { registerReadTool } from '../tools/read.js';
import { registerWriteTool } from '../tools/write.js';
import { registerEditTool } from '../tools/edit.js';
import { registerGlobTool } from '../tools/glob.js';
import { registerGrepTool } from '../tools/grep.js';
import { registerTaskTool } from '../tools/task.js';
import { registerTodoWriteTool } from '../tools/todowrite.js';
import { PermissionMode } from '../pkg/types.js';
import { Provider } from '../pkg/ccswitch/index.js';
import { CCSwitchClient } from '../pkg/ccswitch/index.js';
import { SkillsLoader } from '../skills/loader.js';
import { getSubagentManager } from '../agent/subagent.js';
import { getPlanManager } from '../agent/plan-mode.js';

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
  private provider: Provider;
  private mode: PermissionMode;
  private apiKey: string;
  private baseUrl?: string;
  private model: string;
  private exitRequested = false;
  private tokenUsage = { input: 0, output: 0 };
  private startTime = Date.now();
  private skillsLoader!: SkillsLoader;

  constructor(options: REPLOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.mode = options.mode;
    this.provider = options.provider;
    this.sessionManager = options.sessionManager ?? new SessionManager();
    this.engine = new QueryEngine({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
    });

    const registry = getToolRegistry();
    registerBashTool(registry);
    registerReadTool(registry);
    registerWriteTool(registry);
    registerEditTool(registry);
    registerGlobTool(registry);
    registerGrepTool(registry);
    registerTaskTool(registry);
    registerTodoWriteTool(registry);

    // Load skills and custom slash commands
    this.skillsLoader = new SkillsLoader();
  }

  async start(): Promise<void> {
    // Load skills and custom commands first (synchronous file I/O)
    await this.skillsLoader.loadAll();
    await this.skillsLoader.loadSlashCommands();

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
        const cmdName = trimmed.split(/\s+/)[0]!.slice(1);
        const customCmd = this.skillsLoader?.getSlashCommand(cmdName);
        if (customCmd) {
          const arg = trimmed.slice(trimmed.indexOf(' ') + 1).trim();
          const prompt = customCmd.prompt.replace(/\$ARGUMENTS/g, arg);
          this.processMessage(prompt).then(() => {
            if (this.exitRequested) {
              this.rl?.close();
            } else {
              this.drawInputUI();
            }
          });
          return;
        }

        this.handleSlashCommand(trimmed).then(() => {
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
    this.sessionManager = new SessionManager();
    this.engine = new QueryEngine({ apiKey: this.apiKey, baseUrl: this.baseUrl });
    console.log(`${GREEN}✓${RESET} Conversation cleared`);
  }

  private async compact(_instructions: string): Promise<void> {
    console.log(`${YELLOW}⚠${RESET}  Compaction in progress...`);
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      console.log(`${YELLOW}⚠${RESET}  No active session to compact`);
      return;
    }
    console.log(`${GREEN}✓${RESET} Conversation compacted (simulated)`);
    console.log(
      `${DIM}  Note: Full compaction requires API call (configured in future version)${RESET}`
    );
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
    console.log(`  ${DIM}User memory:${RESET}  ~/.paude/memory/user/`);
    console.log(`  ${DIM}Project memory:${RESET} ~/.paude/memory/project/`);
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
    console.log(`  ${DIM}No MCP servers currently connected${RESET}`);
    console.log(`  ${DIM}Configure with: pacode mcp add <name> <command>${RESET}`);
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
    if (!description) {
      const plan = getPlanManager().getActive();
      if (plan) {
        console.log(getPlanManager().formatPlanMessage(plan));
      } else {
        console.log(`${DIM}Usage: /plan <task description>${RESET}`);
        console.log(`${DIM}Current mode: ${this.mode}${RESET}`);
        if (this.mode === PermissionMode.PLAN) {
          console.log(`${YELLOW}⚠${RESET}  Plan mode is active. Tools are disabled.`);
        }
      }
      return;
    }

    // Switch to plan mode
    if (this.mode !== PermissionMode.PLAN) {
      this.mode = PermissionMode.PLAN;
      console.log(`${GREEN}✓${RESET} Switched to plan mode (tools disabled)`);
    }

    // Generate plan via AI
    const planPrompt = `Create a detailed implementation plan for: ${description}

Format your response as a structured plan with:
- Title and description
- Numbered steps with action descriptions
- For each step, specify the tool (Read/Edit/Bash/etc) and risk level (low/medium/high)
- Use markdown formatting

Focus on breaking down the work into atomic, verifiable steps.`;

    await this.processMessage(planPrompt);
  }

  private async processMessage(message: string): Promise<void> {
    console.log('');
    const session = this.sessionManager.createSession({ mode: this.mode });
    session.messages.push({
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });

    const startTime = Date.now();
    let toolCallCount = 0;

    // Claude Code style: show initial "thinking" indicator
    console.log(`${DIM}⏺ Pontificating…${RESET}`);

    try {
      for await (const event of this.engine.query(
        { message, options: { model: this.model } },
        session
      )) {
        switch (event.type) {
          case 'content_block_delta':
            if (event.delta) {
              // Replace thinking indicator with first content
              process.stdout.write(`\r${event.delta.text}`);
            }
            break;
          case 'tool_use':
            if (event.tool) {
              toolCallCount++;
              console.log('');
              this.renderToolUseClaude(event.tool);
            }
            break;
          case 'tool_result':
            if (event.result) {
              this.renderToolResultClaude(event.tool?.name ?? 'tool', event.result);
            }
            break;
          case 'message_stop':
            // Capture usage info
            if (event.usage) {
              this.tokenUsage.input += event.usage.inputTokens ?? 0;
              this.tokenUsage.output += event.usage.outputTokens ?? 0;
            }
            break;
          case 'error':
            if (event.error) {
              console.log(`\n${RED}⏺ Error: ${event.error.message}${RESET}`);
            }
            break;
        }
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
      console.log(
        `\n${RED}⏺ Error: ${error instanceof Error ? error.message : String(error)}${RESET}\n`
      );
    }
  }

  private renderToolUseClaude(tool: { name: string; input: Record<string, unknown> }): void {
    const input = tool.input;
    let summary = '';

    // Generate human-readable summary based on tool
    if (tool.name === 'Bash') {
      summary = String(input['command'] ?? '').substring(0, 60);
    } else if (tool.name === 'Read') {
      summary = String(input['path'] ?? '');
    } else if (tool.name === 'Write' || tool.name === 'Edit') {
      const path = String(input['path'] ?? '');
      summary = `${tool.name} ${path}`;
    } else if (tool.name === 'Glob') {
      summary = String(input['pattern'] ?? '');
    } else if (tool.name === 'Grep') {
      summary = String(input['pattern'] ?? '');
    } else if (tool.name === 'Task') {
      summary = String(input['prompt'] ?? '').substring(0, 60);
    } else if (tool.name === 'TodoWrite') {
      summary = String(input['action'] ?? 'update task list');
    } else {
      summary = JSON.stringify(input).substring(0, 60);
    }

    console.log(`${CYAN}⏺ ${tool.name}${RESET} ${DIM}${summary}${RESET}`);
  }

  private renderToolResultClaude(
    _toolName: string,
    result: { isError?: boolean; content: Array<{ type: string; text?: string }> }
  ): void {
    const text = result.content[0]?.type === 'text' ? (result.content[0].text ?? '') : '';
    const lines = text.split('\n').filter((l) => l.trim()).length;

    if (result.isError) {
      console.log(`  ${RED}⎿  Error${RESET}`);
      console.log(`  ${DIM}${text.substring(0, 100)}${RESET}`);
    } else {
      // Claude Code style: ⎿  ...output...
      const outputText = text.substring(0, 100).replace(/\n/g, ' ');
      console.log(`  ${DIM}⎿  ${outputText}${lines > 1 ? ` (+${lines - 1} lines)` : ''}${RESET}`);
    }
  }
}

interface REPLOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  mode: PermissionMode;
  provider: Provider;
  sessionManager?: SessionManager;
}
