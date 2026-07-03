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

const log = new Logger({ prefix: 'CLI' });

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      mode: { type: 'string', short: 'm', default: 'default' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log('PaCode CLI - Claude Code-like AI Assistant\nUsage: pacode [options] [message]');
    process.exit(0);
  }

  if (values.version) {
    console.log('PaCode v0.1.0');
    process.exit(0);
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

  const engine = new QueryEngine({});

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
