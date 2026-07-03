#!/usr/bin/env node
/**
 * CLI Entry Point
 */

import { parseArgs } from 'node:util';
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
import { Logger } from '../pkg/logger/index.js';
import { PermissionMode } from '../pkg/types.js';
import { bootAnimation } from './animation.js';
import { getCCSwitch } from '../pkg/ccswitch/index.js';
import { REPL } from './repl.js';

const log = new Logger({ prefix: 'CLI' });

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';

function showHelp(): void {
  console.log(`PaCode CLI - Claude Code-like AI Assistant v0.1.0

Usage:
  pacode [options] [message]       Run AI agent with a message
  pacode cc-switch <command>       Manage API providers (ccswitch integration)

Options:
  -h, --help              Show this help
  -v, --version           Show version
  -m, --mode <mode>       Permission mode (plan|default|acceptEdits|auto|dontAsk|bypass)
  --api-key <key>         Anthropic API key
  --base-url <url>        Custom API base URL (for proxy)
  --model <model>         Model name (default: claude-sonnet-4-0)

CC-Switch Commands:
  pacode cc-switch list              List all configured providers
  pacode cc-switch use               Interactive provider switcher
  pacode cc-switch use <name>        Switch to a specific provider
  pacode cc-switch add <name>        Add a new provider
  pacode cc-switch remove <name>     Remove a provider
  pacode cc-switch import            Import from ~/.claude/settings.json
  pacode cc-switch status            Show current active provider
  pacode cc-switch detect            Detect available config sources

Environment:
  ANTHROPIC_API_KEY       Your Anthropic API key
  ANTHROPIC_BASE_URL      Custom base URL
  CLAUDE_MODEL            Default model

Examples:
  pacode "Read package.json and explain the project"
  pacode -m acceptEdits "Add error handling to index.ts"
  pacode cc-switch add anthropic --api-key sk-xxx
  pacode cc-switch use
`);
}

async function handleCCSwitch(
  positionals: string[],
  options: Record<string, unknown>
): Promise<boolean> {
  const subCmd = positionals[0];
  const args = positionals.slice(1);
  const cc = getCCSwitch();

  switch (subCmd) {
    case 'list': {
      const providers = cc.list();
      if (providers.length === 0) {
        console.log('No providers configured. Use: pacode cc-switch add <name> --api-key=<key>');
        return true;
      }
      const active = cc.getActive();
      console.log('\nProviders:');
      providers.forEach((p) => {
        const marker = active?.name === p.name ? '●' : '○';
        const model = p.model ? ` (${p.model})` : '';
        const url = p.baseUrl ? ` → ${p.baseUrl}` : '';
        console.log(`  ${marker} ${p.name}${model}${url}`);
      });
      console.log('');
      return true;
    }

    case 'use': {
      const name = args[0] || (options.name as string);
      if (!name) {
        await cc.interactiveSwitch();
      } else {
        const p = cc.switchTo(name);
        if (p) {
          console.log(`✓ Switched to: ${p.name}`);
        } else {
          console.error(`Provider not found: ${name}`);
          process.exit(1);
        }
      }
      return true;
    }

    case 'add': {
      const name = args[0] || (options.name as string);
      if (!name) {
        console.error(
          'Usage: pacode cc-switch add <name> --api-key=<key> [--base-url=<url>] [--model=<model>]'
        );
        process.exit(1);
      }
      const apiKey = (options['api-key'] as string) || process.env['ANTHROPIC_API_KEY'];
      const baseUrl = (options['base-url'] as string) || process.env['ANTHROPIC_BASE_URL'];
      const model = (options.model as string) || process.env['CLAUDE_MODEL'];

      if (!apiKey) {
        console.error('--api-key is required');
        process.exit(1);
      }

      cc.addProvider({ name, apiKey, baseUrl, model });
      console.log(`✓ Added provider: ${name}`);
      return true;
    }

    case 'remove': {
      const name = args[0] || (options.name as string);
      if (!name) {
        console.error('Usage: pacode cc-switch remove <name>');
        process.exit(1);
      }
      console.log(`✓ Removed: ${name}`);
      console.log('  (Note: Edit ~/.paude/providers.json to fully remove)');
      return true;
    }

    case 'import': {
      const count = cc.importFromClaudeCode();
      console.log(`✓ Imported ${count} provider(s) from ~/.claude/settings.json`);
      return true;
    }

    case 'status': {
      const active = cc.getActive();
      if (active) {
        console.log(`\nActive provider: ${active.name}`);
        if (active.model) console.log(`  Model: ${active.model}`);
        if (active.baseUrl) console.log(`  Base URL: ${active.baseUrl}`);
        console.log(`  API Key: ${active.apiKey.slice(0, 8)}...${active.apiKey.slice(-4)}`);
      } else {
        console.log('\nNo active provider. Use: pacode cc-switch use <name>');
      }
      console.log('');
      return true;
    }

    case 'detect': {
      const sources = cc.detectSources();
      const configPath = cc.getConfigPath();
      console.log('\nCC-Switch detection:');
      console.log(
        `  CC-Switch app:     ${sources.ccswitch ? `${GREEN}✓ found${RESET}` : `${GRAY}○ not found${RESET}`}`
      );
      console.log(
        `  Claude Code:       ${sources.claudeCode ? `${GREEN}✓ found${RESET}` : `${GRAY}○ not found${RESET}`}`
      );
      console.log(
        `  PaCode:            ${sources.pacode ? `${GREEN}✓ found${RESET}` : `${GRAY}○ not found${RESET}`}`
      );
      console.log(`\n  Config: ${configPath}\n`);
      return true;
    }

    default:
      console.error(`Unknown cc-switch command: ${subCmd}`);
      console.error('Run: pacode --help for usage');
      return true;
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      mode: { type: 'string', short: 'm', default: 'default' },
      'api-key': { type: 'string' },
      'base-url': { type: 'string' },
      model: { type: 'string' },
      name: { type: 'string' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  if (values.version) {
    console.log('PaCode v0.1.0');
    process.exit(0);
  }

  // Handle cc-switch subcommand
  if (positionals[0] === 'cc-switch' || positionals[0] === 'ccs') {
    await handleCCSwitch(positionals.slice(1), values);
    process.exit(0);
  }

  // Show boot animation
  await bootAnimation.show();

  // Get credentials (cc-switch active provider takes priority)
  const cc = getCCSwitch();

  // Auto-import from Claude Code if no providers configured
  if (cc.list().length === 0) {
    const imported = cc.autoImportFromClaudeCode();
    if (imported) {
      console.log(
        `${DIM}Auto-imported provider from ~/.claude/settings.json: ${imported.name}${RESET}\n`
      );
    }
  }

  const creds = cc.getCredentials();
  const apiKey = (values['api-key'] as string) || creds.apiKey;
  const baseUrl = (values['base-url'] as string) || creds.baseUrl;
  const model = (values.model as string) || creds.model || 'claude-sonnet-4-0';

  if (!apiKey) {
    log.error('ANTHROPIC_API_KEY not set');
    console.log(`
Please set your Anthropic API key:

  export ANTHROPIC_API_KEY=sk-ant-xxx

Or use CC-Switch to manage providers:

  pacode cc-switch add anthropic --api-key sk-ant-xxx
  pacode cc-switch use anthropic

Get a key at: https://console.anthropic.com/
`);
    process.exit(1);
  }

  const activeProvider = cc.getActive();
  const mode = resolveMode(values.mode as string);

  // Show active provider info
  if (activeProvider) {
    console.log(
      `\n${DIM}Active: ${activeProvider.name} (${model})${baseUrl ? ` → ${baseUrl}` : ''}${RESET}`
    );
  }

  const message = positionals.join(' ');

  // If no message, start REPL mode
  if (!message) {
    const repl = new REPL({
      apiKey,
      baseUrl,
      model,
      mode,
      provider: activeProvider ?? { name: 'default', apiKey },
    });
    await repl.start();
    return;
  }

  // Single message mode
  const toolRegistry = getToolRegistry();
  registerBashTool(toolRegistry);
  registerReadTool(toolRegistry);
  registerWriteTool(toolRegistry);
  registerEditTool(toolRegistry);
  registerGlobTool(toolRegistry);
  registerGrepTool(toolRegistry);
  registerTaskTool(toolRegistry);
  registerTodoWriteTool(toolRegistry);

  const sessionManager = new SessionManager();
  const session = sessionManager.createSession({ mode });

  session.messages.push({ role: 'user', content: message, timestamp: Date.now() });

  const engine = new QueryEngine({ apiKey, baseUrl });

  console.log('\nPaCode:\n');

  let hasAuthError = false;
  for await (const event of engine.query({ message, options: { model } }, session)) {
    if (event.type === 'content_block_delta' && event.delta) {
      process.stdout.write(event.delta.text);
    } else if (event.type === 'tool_use' && event.tool) {
      console.log(`\n[Using tool: ${event.tool.name}]\n`);
    } else if (event.type === 'message_stop') {
      console.log('\n');
    } else if (event.type === 'error' && event.error) {
      log.error(event.error.message);
      if (
        event.error.message.includes('401') ||
        event.error.message.includes('Invalid token') ||
        event.error.message.includes('authentication')
      ) {
        hasAuthError = true;
      }
    }
  }

  if (hasAuthError) {
    console.log(`\n${DIM}💡 Tip: Switch to a different provider with:${RESET}`);
    console.log(`  pacode cc-switch list`);
    console.log(`  pacode cc-switch use <name>`);
  }

  sessionManager.saveSession(session);
}

function resolveMode(mode: string): PermissionMode {
  const modes: Record<string, PermissionMode> = {
    plan: PermissionMode.PLAN,
    default: PermissionMode.DEFAULT,
    acceptEdits: PermissionMode.ACCEPT_EDITS,
    auto: PermissionMode.AUTO,
    dontAsk: PermissionMode.DONT_ASK,
    bypass: PermissionMode.BYPASS,
  };
  return modes[mode] ?? PermissionMode.DEFAULT;
}

main().catch((err) => {
  log.error('Fatal:', err);
  process.exit(1);
});
