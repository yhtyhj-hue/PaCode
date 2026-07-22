#!/usr/bin/env node
/**
 * CLI Entry Point
 */

import { Logger } from '../pkg/logger/index.js';
import { bootAnimation } from './animation.js';
import { getCCSwitch, getProviderPreset } from '../pkg/ccswitch/index.js';
import { REPL } from './repl.js';
import { resolveAppConfig } from '../pkg/app-config.js';
import {
  handleMcp,
  handleInit,
  handleResume,
  handleWorktree,
  handleCCSwitch,
  handleBridge,
  showHelp,
} from './handlers.js';
import { parseCliArgs } from './args.js';
import { loadImageFromFile } from '../services/image-attach/index.js';
import type { ImageSource } from '../pkg/types.js';
import { shouldEnableTui, startInkRepl } from './tui/index.js';
import { runAgent } from '../sdk/run-agent.js';
import { formatPacodeVersion } from '../pkg/version.js';

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
    console.log(formatPacodeVersion());
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

  if (positionals[0] === 'bridge') {
    const ok = await handleBridge(positionals.slice(1));
    process.exit(ok ? 0 : 1);
  }

  const cc = getCCSwitch();
  const presetId = values.preset as string | undefined;
  const preset = presetId ? getProviderPreset(presetId) : undefined;
  if (presetId && !preset) {
    log.error(`Unknown preset: ${presetId}`);
    console.log('Run: pacode cc-switch presets');
    process.exit(1);
  }

  // --preset 仅补全未显式传入的 model/baseUrl/authStyle（不写入 providers.json）
  const appConfig = resolveAppConfig({
    mode: values.mode as string | undefined,
    model: (values.model as string | undefined) ?? preset?.model,
    apiKey: values['api-key'] as string | undefined,
    baseUrl: (values['base-url'] as string | undefined) ?? preset?.baseUrl,
    authStyle: preset?.authStyle,
    apiProtocol: preset?.apiProtocol,
  });

  const model = appConfig.model;
  const activeProvider = cc.getActive();

  const printMode = Boolean(values.print);
  let message = positionals.join(' ').trim();
  // -p 且无 positional：从 stdin 读（管道友好）
  if (printMode && !message && !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    message = Buffer.concat(chunks).toString('utf-8').trim();
  }

  if (!printMode) {
    await bootAnimation.show({
      model,
      apiKeyConfigured: Boolean(appConfig.apiKey),
      providerCount: cc.list().length,
      activeProvider: activeProvider?.name,
    });
  }

  const apiKey = appConfig.apiKey;
  const baseUrl = appConfig.baseUrl;

  if (!apiKey) {
    log.error('ANTHROPIC_API_KEY not set');
    console.log(`
Please set an API key (MiniMax by default, or DeepSeek / 豆包 / …):

  export ANTHROPIC_API_KEY=your_key
  # or: PACODE_API_KEY

Or add a provider preset:

  pacode cc-switch presets
  pacode cc-switch add deepseek --preset=deepseek --api-key=sk-xxx
  pacode cc-switch use deepseek
`);
    process.exit(1);
  }

  const mode = appConfig.mode;

  if (activeProvider && !printMode) {
    console.log(
      `\n${DIM}Active: ${activeProvider.name} (${model})${baseUrl ? ` → ${baseUrl}` : ''}${RESET}`
    );
  }

  if (values.resume && !message) {
    await handleResume([], values);
    return;
  }

  if (!message) {
    if (printMode) {
      log.error('No message for -p / --print (pass args or pipe stdin)');
      process.exit(1);
    }
    const useTui = shouldEnableTui({
      tuiFlag: Boolean(values.tui),
      env: process.env,
    });
    if (useTui) {
      await startInkRepl({
        apiKey,
        baseUrl,
        model,
        mode,
        authStyle: appConfig.authStyle,
        apiProtocol: appConfig.apiProtocol,
        provider: activeProvider ?? {
          name: 'default',
          apiKey,
          authStyle: appConfig.authStyle,
          apiProtocol: appConfig.apiProtocol,
        },
      });
      return;
    }
    const repl = new REPL({
      apiKey,
      baseUrl,
      model,
      mode,
      authStyle: appConfig.authStyle,
      apiProtocol: appConfig.apiProtocol,
      provider: activeProvider ?? {
        name: 'default',
        apiKey,
        authStyle: appConfig.authStyle,
        apiProtocol: appConfig.apiProtocol,
      },
    });
    await repl.start();
    return;
  }

  const imagePaths = (values.image as string[] | undefined) ?? [];
  const images: ImageSource[] = [];
  for (const p of imagePaths) {
    try {
      images.push(loadImageFromFile(p));
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }

  if (!printMode) {
    console.log('\nPaCode:\n');
  }

  let hasAuthError = false;
  const result = await runAgent({
    message,
    mode,
    model,
    apiKey,
    baseUrl,
    authStyle: appConfig.authStyle,
    apiProtocol: appConfig.apiProtocol,
    maxTokens: appConfig.maxTokens,
    temperature: appConfig.temperature,
    images: images.length > 0 ? images : undefined,
    onEvent: (event) => {
      if (event.type === 'content_block_delta' && event.delta) {
        process.stdout.write(event.delta.text);
      } else if (event.type === 'tool_use' && event.tool && !printMode) {
        console.log(`\n[Using tool: ${event.tool.name}]\n`);
      } else if (event.type === 'message_stop' && !printMode) {
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
    },
  });

  if (printMode && result.text && !result.text.endsWith('\n')) {
    process.stdout.write('\n');
  }

  if (hasAuthError) {
    console.log(`\n${DIM}💡 Tip: Switch to a different provider with:${RESET}`);
    console.log(`  pacode cc-switch list`);
    console.log(`  pacode cc-switch use <name>`);
  }

  if (printMode && result.hadError) {
    process.exit(1);
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
