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

const log = new Logger({ prefix: 'CLI' });

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      mode: { type: 'string', short: 'm', default: 'default' },
      'api-key': { type: 'string' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`PaCode CLI - Claude Code-like AI Assistant v0.1.0

Usage: pacode [options] [message]

Options:
  -h, --help              Show this help
  -v, --version           Show version
  -m, --mode <mode>       Permission mode (plan|default|acceptEdits|auto|dontAsk|bypass)
  --api-key <key>         Anthropic API key (or set ANTHROPIC_API_KEY env)

Environment:
  ANTHROPIC_API_KEY       Your Anthropic API key
  CLAUDE_MODEL            Default model (default: claude-sonnet-4-0)
  CLAUDE_MAX_TOKENS       Max output tokens (default: 8192)

Examples:
  pacode "Read package.json and explain the project"
  pacode -m acceptEdits "Add error handling to index.ts"
  ANTHROPIC_API_KEY=sk-xxx pacode "Hello"
`);
    process.exit(0);
  }

  if (values.version) {
    console.log('PaCode v0.1.0');
    process.exit(0);
  }

  // Show boot animation
  await bootAnimation.show();

  // Check for API key
  const apiKey = (values['api-key'] as string) || process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    log.error('ANTHROPIC_API_KEY not set');
    console.log(`
Please set your Anthropic API key:

  export ANTHROPIC_API_KEY=sk-ant-xxx

Or pass it directly:

  pacode --api-key sk-ant-xxx "your question"

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

  const engine = new QueryEngine({ apiKey });

  console.log('\nPaCode:\n');

  for await (const event of engine.query({ message }, session)) {
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
