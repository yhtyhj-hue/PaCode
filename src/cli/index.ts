#!/usr/bin/env node
/**
 * CLI Entry Point
 */

import { QueryEngine } from '../agent/engine.js';
import { SessionManager } from '../session/manager.js';
import { setupToolRegistry } from '../tools/setup.js';
import { getSubagentManager } from '../agent/subagent.js';
import { Logger } from '../pkg/logger/index.js';
import { bootAnimation } from './animation.js';
import { getCCSwitch } from '../pkg/ccswitch/index.js';
import { REPL } from './repl.js';
import { resolveAppConfig } from '../pkg/app-config.js';
import {
  handleMcp,
  handleInit,
  handleResume,
  handleWorktree,
  handleCCSwitch,
  showHelp,
} from './handlers.js';
import { parseCliArgs } from './args.js';

const log = new Logger({ prefix: 'CLI' });

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

async function main() {
  const { values, positionals } = parseCliArgs();

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  if (values.version) {
    console.log('PaCode v0.1.0');
    process.exit(0);
  }

  if (positionals[0] === 'cc-switch' || positionals[0] === 'ccs') {
    await handleCCSwitch(positionals.slice(1), values);
    process.exit(0);
  }

  if (positionals[0] === 'mcp') {
    await handleMcp(positionals.slice(1));
    process.exit(0);
  }

  if (positionals[0] === 'init') {
    await handleInit();
    process.exit(0);
  }

  if (positionals[0] === 'resume') {
    await handleResume(positionals.slice(1), values);
    return;
  }

  if (positionals[0] === 'worktree' || positionals[0] === 'wt') {
    await handleWorktree(positionals.slice(1));
    process.exit(0);
  }

  const cc = getCCSwitch();
  if (cc.list().length === 0) {
    const imported = cc.autoImportFromClaudeCode();
    if (imported) {
      console.log(
        `${DIM}Auto-imported provider from ~/.claude/settings.json: ${imported.name}\x1b[0m\n`
      );
    }
  }
  const appConfig = resolveAppConfig({
    mode: values.mode as string | undefined,
    model: values.model as string | undefined,
    apiKey: values['api-key'] as string | undefined,
    baseUrl: values['base-url'] as string | undefined,
  });

  const model = appConfig.model;
  const activeProvider = cc.getActive();

  await bootAnimation.show({
    model,
    apiKeyConfigured: Boolean(appConfig.apiKey),
    providerCount: cc.list().length,
    activeProvider: activeProvider?.name,
  });

  const apiKey = appConfig.apiKey;
  const baseUrl = appConfig.baseUrl;

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

  const mode = appConfig.mode;

  if (activeProvider) {
    console.log(
      `\n${DIM}Active: ${activeProvider.name} (${model})${baseUrl ? ` → ${baseUrl}` : ''}${RESET}`
    );
  }

  const message = positionals.join(' ');

  if (values.resume && !message) {
    await handleResume([], values);
    return;
  }

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

  const { registry: toolRegistry, hookRegistry } = await setupToolRegistry({
    apiKey,
    baseUrl,
    model,
    bootstrapPlugins: true,
    subagentManager: getSubagentManager(),
  });

  const sessionManager = new SessionManager();
  const session = sessionManager.createSession({ mode });

  session.messages.push({ role: 'user', content: message, timestamp: Date.now() });

  const engine = new QueryEngine({
    apiKey,
    baseUrl,
    toolRegistry,
    sessionManager,
    hookRegistry,
  });

  console.log('\nPaCode:\n');

  let hasAuthError = false;
  for await (const event of engine.query(
    { message, options: { model, maxTokens: appConfig.maxTokens, temperature: appConfig.temperature } },
    session
  )) {
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

main().catch((err) => {
  log.error('Fatal:', err);
  process.exit(1);
});
