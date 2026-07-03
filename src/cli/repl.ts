/**
 * REPL - Interactive Chat Mode
 *
 * Continuous conversation like Claude Code CLI.
 */

import { createInterface, Interface } from 'node:readline';
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

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

const SLASH_COMMANDS: Record<string, string> = {
  '/help': 'Show help',
  '/clear': 'Clear conversation history',
  '/exit': 'Exit REPL',
  '/quit': 'Exit REPL',
  '/mode': 'Change permission mode',
  '/status': 'Show session status',
  '/providers': 'List API providers',
  '/memory': 'Show memory location',
};

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
  }

  async start(): Promise<void> {
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

      // Handle commands asynchronously without blocking the line event
      if (trimmed.startsWith('/')) {
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
    console.log(`${CYAN}${BOLD}  💬 Interactive Mode${RESET} ${DIM}- Type your message and press Enter${RESET}`);
    console.log(`${DIM}  Commands: /help | /clear | /exit | /mode | /status${RESET}`);
    console.log('');
  }

  private printGoodbye(): void {
    console.log('');
    console.log(`${GREEN}✓${RESET} Session saved. Goodbye!`);
    console.log('');
  }

  private getPrompt(): string {
    return `${CYAN}❯${RESET} `;
  }

  private async handleSlashCommand(cmd: string): Promise<void> {
    const [command, ...args] = cmd.split(/\s+/);

    switch (command) {
      case '/help':
      case '/help-commands':
        this.printHelp();
        break;
      case '/clear':
        this.sessionManager = new SessionManager();
        this.engine = new QueryEngine({ apiKey: this.apiKey, baseUrl: this.baseUrl });
        console.log(`${GREEN}✓${RESET} Conversation cleared`);
        break;
      case '/exit':
      case '/quit':
        this.exitRequested = true;
        break;
      case '/mode': {
        const newMode = args[0];
        if (newMode) {
          const modes: Record<string, PermissionMode> = {
            plan: PermissionMode.PLAN,
            default: PermissionMode.DEFAULT,
            acceptEdits: PermissionMode.ACCEPT_EDITS,
            auto: PermissionMode.AUTO,
            dontAsk: PermissionMode.DONT_ASK,
            bypass: PermissionMode.BYPASS,
          };
          this.mode = modes[newMode] ?? this.mode;
          console.log(`${GREEN}✓${RESET} Mode: ${this.mode}`);
        } else {
          console.log(`Current mode: ${this.mode}`);
          console.log(`Available: plan, default, acceptEdits, auto, dontAsk, bypass`);
        }
        break;
      }
      case '/status':
        this.printStatus();
        break;
      case '/providers':
        console.log(`${DIM}Use: pacode cc-switch list${RESET}`);
        break;
      case '/memory':
        console.log(`${DIM}Memory: ~/.paude/memory/${RESET}`);
        break;
      default:
        console.log(`${YELLOW}?${RESET} Unknown command: ${command}. Try /help`);
    }
  }

  private printHelp(): void {
    console.log('');
    console.log(`${CYAN}${BOLD}Available Commands${RESET}`);
    console.log('');
    for (const [cmd, desc] of Object.entries(SLASH_COMMANDS)) {
      console.log(`  ${CYAN}${cmd.padEnd(18)}${RESET}${desc}`);
    }
    console.log('');
    console.log(`${DIM}Permission modes: plan, default, acceptEdits, auto, dontAsk, bypass${RESET}`);
    console.log('');
  }

  private printStatus(): void {
    console.log('');
    console.log(`${CYAN}${BOLD}Session Status${RESET}`);
    console.log(`  Provider: ${this.provider.name}`);
    console.log(`  Model: ${this.model}`);
    if (this.baseUrl) console.log(`  Base URL: ${this.baseUrl}`);
    console.log(`  Mode: ${this.mode}`);
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
      console.log(`\n${YELLOW}Error: ${error instanceof Error ? error.message : String(error)}${RESET}\n`);
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