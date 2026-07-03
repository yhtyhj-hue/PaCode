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

const log = new Logger({ prefix: 'CLI' });

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

async function handleCCSwitch(positionals: string[], options: Record<string, unknown>): Promise<boolean> {
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
      providers.forEach(p => {
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
        console.error('Usage: pacode cc-switch add <name> --api-key=<key> [--base-url=<url>] [--model=<model>]');
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
  const mode = resolveMode(values.mode as string);
  const session = sessionManager.createSession({ mode });

  const message = positionals.join(' ') || 'Hello';
  session.messages.push({ role: 'user', content: message, timestamp: Date.now() });

  const engine = new QueryEngine({ apiKey, baseUrl });

  console.log('\nPaCode:\n');

  for await (const event of engine.query({ message, options: { model } }, session)) {
    if (event.type === 'content_block_delta' && event.delta) {
      process.stdout.write(event.delta.text);
    } else if (event.type === 'tool_use' && event.tool) {
      console.log(`\n[Using tool: ${event.tool.name}]\n`);
    } else if (event.type === 'message_stop') {
      console.log('\n');
    } else if (event.type === 'error' && event.error) {
      log.error(event.error.message);
    }
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
