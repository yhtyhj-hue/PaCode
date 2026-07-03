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

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.getPrompt(),
    });

    this.rl.prompt();

    this.rl.on('line', (input) => {
      const trimmed = input.trim();

      if (this.exitRequested || !this.rl) {
        this.rl?.close();
        return;
      }

      if (trimmed.startsWith('/')) {
        // Check if it's a custom slash command from .claude/commands/
        const cmdName = trimmed.split(/\s+/)[0]!.slice(1);
        const customCmd = this.skillsLoader?.getSlashCommand(cmdName);
        if (customCmd) {
          const arg = trimmed.slice(trimmed.indexOf(' ') + 1).trim();
          const prompt = customCmd.prompt.replace(/\$ARGUMENTS/g, arg);
          this.processMessage(prompt).then(() => {
            if (this.exitRequested) {
              this.rl?.close();
            } else {
              this.rl?.prompt();
            }
          });
          return;
        }

        this.handleSlashCommand(trimmed).then(() => {
          if (this.exitRequested || !this.rl) {
            this.rl?.close();
          } else {
            this.rl?.prompt();
          }
        });
        return;
      }

      if (!trimmed) {
        this.rl.prompt();
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
          this.rl?.prompt();
        }
      });
    });

    this.rl.on('close', () => {
      this.printGoodbye();
      process.exit(0);
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

  private getPrompt(): string {
    return `${CYAN}❯${RESET} `;
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

  private async processMessage(message: string): Promise<void> {
    console.log('');
    const session = this.sessionManager.createSession({ mode: this.mode });
    session.messages.push({
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });

    try {
      for await (const event of this.engine.query(
        { message, options: { model: this.model } },
        session
      )) {
        switch (event.type) {
          case 'content_block_delta':
            if (event.delta) {
              process.stdout.write(event.delta.text);
            }
            break;
          case 'tool_use':
            if (event.tool) {
              console.log(`\n${DIM}[Tool: ${event.tool.name}]${RESET}`);
            }
            break;
          case 'tool_result':
            if (event.result?.isError) {
              console.log(`\n${YELLOW}⚠ Tool error${RESET}`);
            }
            break;
          case 'error':
            if (event.error) {
              console.log(`\n${YELLOW}Error: ${event.error.message}${RESET}`);
            }
            break;
        }
      }
      console.log('\n');
      this.sessionManager.saveSession(session);
    } catch (error) {
      console.log(
        `\n${YELLOW}Error: ${error instanceof Error ? error.message : String(error)}${RESET}\n`
      );
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
