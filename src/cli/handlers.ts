/**
 * CLI command handlers — testable without spawning process
 */

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadMcpConfig, saveMcpConfig, getMcpConfigPath } from '../mcp/config.js';
import { validateMcpServerEntry } from '../mcp/validate.js';
import { getSessionResume, SessionResume } from './resume.js';
import { getCCSwitch, CCSwitchClient, formatPresetTable, getProviderPreset, normalizePlanMode, normalizeApiProtocol, inferPlanModeFromBaseUrl, inferApiProtocolFromBaseUrl } from '../pkg/ccswitch/index.js';
import type { ImportSourceId } from '../pkg/ccswitch/import-sources.js';
import {
  fetchModelsDevCatalog,
  formatModelsDevTable,
  getModelsDevProvider,
  listModelsDevProviders,
  modelsDevToProviderDraft,
} from '../pkg/models-dev/catalog.js';
import { REPL } from './repl.js';
import { getWorktreeManager, WorktreeManager } from './worktree.js';
import { DEFAULT_MODEL } from '../pkg/defaults.js';
import { getPackageVersion } from '../pkg/version.js';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';

export function showHelp(): void {
  console.log(`PaCode CLI - Claude Code-like AI Assistant v${getPackageVersion()}

Usage:
  pacode [options] [message]       Run AI agent with a message
  pacode -p [message]              Headless print (no REPL; stdin if no args)
  pacode init                      Initialize .paude/ and CLAUDE.md
  pacode mcp <command>             Manage MCP server configuration
  pacode cc-switch <command>       Manage API providers (ccswitch integration)
  pacode resume [session-id]       Resume a saved REPL session
  pacode resume list               List saved sessions
  pacode worktree <command>        Manage git worktrees for parallel work
  pacode bridge serve              Start local WebSocket session relay

Options:
  -h, --help              Show this help
  -v, --version           Show version
  -p, --print             Headless mode (skip boot/REPL; exit 1 on agent error)
  -m, --mode <mode>       Permission mode (plan|default|acceptEdits|auto|dontAsk|bypass)
  --resume                Resume latest saved session (REPL mode)
  --session-id <id>       Resume specific session id
  --api-key <key>         Anthropic API key
  --base-url <url>        Custom API base URL (for proxy)
  --model <model>         Model name (default: ${DEFAULT_MODEL})
  --preset <id>           One-shot provider preset (deepseek|doubao|minimax|…)
  --tui                   Launch Ink TUI REPL (also PACODE_TUI=1)
  --image <path>          Attach image for vision (repeatable; png/jpeg/gif/webp)

CC-Switch Commands:
  pacode cc-switch list              List all configured providers
  pacode cc-switch presets [--plan=] List presets (api|token-plan|coding-plan)
  pacode cc-switch use               Interactive provider switcher
  pacode cc-switch use <name>        Switch to a specific provider
  pacode cc-switch add <name>        Add (--preset=… --plan=token-plan|coding-plan)
  pacode cc-switch remove <name>     Remove a provider
  pacode cc-switch import [--from=]  Import from CC Switch DB / Claude settings
  pacode cc-switch models-dev        Browse Models.dev (OpenAI/Anthropic compatible)
  pacode cc-switch status            Show current active provider
  pacode cc-switch detect            Detect CC Switch / Claude / PaCode sources

Worktree Commands:
  pacode worktree list               List all git worktrees
  pacode worktree create <name>      Create worktree at .claude/worktrees/<name>
  pacode worktree remove <name>      Remove a PaCode-managed worktree

MCP Commands:
  pacode mcp list                    List configured MCP servers
  pacode mcp add <name> <cmd>        Add stdio MCP server
  pacode mcp remove <name>           Remove MCP server

Environment:
  ANTHROPIC_API_KEY       Your Anthropic API key
  ANTHROPIC_BASE_URL      Custom base URL
  CLAUDE_MODEL / PACODE_MODEL  Default model (MiniMax-M3)
  ANTHROPIC_BASE_URL / PACODE_BASE_URL  MiniMax Anthropic gateway
  PACODE_API_KEY / ANTHROPIC_API_KEY    MiniMax API key
  PACODE_AUTO_APPROVE     Set to 1 to allow tool prompts in non-TTY environments
  PACODE_HOOK_FAIL_OPEN   Set to 1 to continue when PreToolUse hooks throw (default: deny)
  PACODE_TUI              Set to 1 to launch Ink TUI instead of readline REPL
  PACODE_STATUSLINE_CMD   Statusline script (stdin JSON → one stdout line); else ~/.paude/statusline.sh
  PACODE_LSP_PYTHON       Override Python LSP command (e.g. "pyright-langserver --stdio")
  PACODE_CLASSIFIER       auto|deterministic|ml (ml = feature heuristics + optional CMD, not a neural net)
  PACODE_CLASSIFIER_CMD   Optional shell classifier for AUTO mode

Examples:
  pacode "Read package.json and explain the project"
  pacode -p "Summarize this repo"
  echo "list TODOs" | pacode -p
  pacode --tui
  pacode -m acceptEdits "Add error handling to index.ts"
  pacode --image shot.png "Describe this screenshot"
  pacode cc-switch add deepseek --preset=deepseek --api-key sk-xxx
  pacode cc-switch add doubao --preset=doubao --api-key ark-xxx
  pacode cc-switch add glm --preset=glm --api-key xxx
  pacode cc-switch add hunyuan --preset=hunyuan --api-key xxx
  pacode cc-switch add qwen --preset=qwen --api-key sk-xxx
  pacode cc-switch add ollama --preset=ollama
  pacode cc-switch add openai --preset=openai --api-key sk-xxx
  pacode cc-switch models-dev --q=groq
  pacode cc-switch models-dev add openrouter --api-key=sk-xxx
  pacode cc-switch import
  pacode cc-switch import --from=cc-switch
  pacode cc-switch use deepseek
`);
}

export interface McpHandlerOptions {
  configPath?: string;
  exit?: (code: number) => never;
}

export interface InitHandlerOptions {
  cwd?: string;
}

export interface ResumeHandlerOptions {
  sessionsDir?: string;
  resume?: SessionResume;
  /** 测试注入：跳过 REPL 启动 */
  startRepl?: (repl: REPL) => Promise<void>;
  exit?: (code: number) => never;
}

export async function handleMcp(
  positionals: string[],
  options: McpHandlerOptions = {}
): Promise<boolean> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const subCmd = positionals[0];
  if (!subCmd) {
    console.error('Usage: pacode mcp list|add|remove');
    exit(1);
    return false;
  }
  const args = positionals.slice(1);
  const configPath = options.configPath ?? getMcpConfigPath();

  switch (subCmd) {
    case 'list': {
      const config = loadMcpConfig(configPath);
      console.log('\nMCP Servers:');
      if (Object.keys(config.servers).length === 0) {
        console.log(`  ${DIM}No servers configured${RESET}`);
      }
      for (const [name, conf] of Object.entries(config.servers)) {
        const cmd = conf.command || 'unknown';
        console.log(`  ${CYAN}${name}${RESET}: ${cmd}`);
      }
      console.log(`\n  Config: ${configPath}\n`);
      return true;
    }

    case 'add': {
      const name = args[0];
      if (!name) {
        console.error('Usage: pacode mcp add <name> <command> [args...]');
        exit(1);
        return false;
      }
      const command = args[1];
      if (!command) {
        console.error('Usage: pacode mcp add <name> <command> [args...]');
        exit(1);
        return false;
      }
      const cmdArgs = args.slice(2);
      const entry = { type: 'stdio' as const, command, args: cmdArgs };
      const validationError = validateMcpServerEntry(entry);
      if (validationError) {
        console.error(validationError);
        exit(1);
        return false;
      }
      const config = loadMcpConfig(configPath);
      config.servers[name] = entry;
      saveMcpConfig(config, configPath);
      console.log(`${GREEN}✓${RESET} Added MCP server: ${name}`);
      return true;
    }

    case 'remove': {
      const name = args[0];
      if (!name) {
        console.error('Usage: pacode mcp remove <name>');
        exit(1);
        return false;
      }
      const config = loadMcpConfig(configPath);
      if (config.servers[name]) {
        delete config.servers[name];
        saveMcpConfig(config, configPath);
        console.log(`${GREEN}✓${RESET} Removed: ${name}`);
      } else {
        console.log(`${YELLOW}⚠${RESET} Not found: ${name}`);
      }
      return true;
    }

    default:
      console.error(`Unknown mcp command: ${subCmd}`);
      console.error('Commands: list, add <name> <command>, remove <name>');
      return false;
  }
}

export async function handleInit(options: InitHandlerOptions = {}): Promise<boolean> {
  const cwd = options.cwd ?? process.cwd();
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  const paudeDir = join(cwd, '.paude');
  const memoryDir = join(paudeDir, 'memory');
  const sessionsDir = join(paudeDir, 'sessions');

  for (const dir of [paudeDir, memoryDir, sessionsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  console.log(`${GREEN}✓${RESET} Initialized .paude/ (memory, sessions)`);

  if (existsSync(claudeMdPath)) {
    console.log(`${YELLOW}⚠${RESET} CLAUDE.md already exists at ${claudeMdPath}`);
    return true;
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
  writeFileSync(claudeMdPath, template, 'utf-8');
  console.log(`${GREEN}✓${RESET} Created CLAUDE.md`);
  return true;
}

export async function handleResume(
  positionals: string[],
  values: Record<string, unknown>,
  options: ResumeHandlerOptions = {}
): Promise<boolean> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const subCmd = positionals[0];
  const resume = options.resume ?? getSessionResume(options.sessionsDir);

  if (subCmd === 'list' || subCmd === 'ls') {
    const sessions = resume.list();
    console.log('\nSaved Sessions:');
    if (sessions.length === 0) {
      console.log(`  ${DIM}No saved sessions${RESET}`);
    } else {
      for (const s of sessions) {
        console.log(
          `  ${CYAN}${s.id}${RESET} · ${s.messageCount} msgs · ${s.mode} · ${s.modified.toLocaleString()}`
        );
      }
    }
    console.log('');
    return true;
  }

  const sessionId =
    subCmd || (values['session-id'] as string | undefined) || resume.getLatest()?.id;

  if (!sessionId) {
    console.error('No session to resume. Use: pacode resume list');
    exit(1);
    return false;
  }

  const session = resume.load(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    exit(1);
    return false;
  }

  console.log(
    `${GREEN}✓${RESET} Resuming session ${sessionId} (${session.messages.length} messages)`
  );

  const cc = getCCSwitch();
  const activeProvider = cc.getActive();
  const apiKey =
    (values['api-key'] as string | undefined) ??
    activeProvider?.apiKey ??
    process.env['ANTHROPIC_API_KEY'] ??
    '';
  const baseUrl =
    (values['base-url'] as string | undefined) ??
    activeProvider?.baseUrl ??
    process.env['ANTHROPIC_BASE_URL'];
  const model =
    (values.model as string | undefined) ??
    activeProvider?.model ??
    process.env['CLAUDE_MODEL'] ??
    DEFAULT_MODEL;

  const repl = new REPL({
    apiKey,
    baseUrl,
    model,
    mode: session.mode,
    provider: activeProvider ?? { name: 'default', apiKey },
    initialSession: session,
  });

  if (options.startRepl) {
    await options.startRepl(repl);
  } else {
    await repl.start();
  }
  return true;
}

export interface WorktreeHandlerOptions {
  worktree?: Pick<WorktreeManager, 'isGitRepo' | 'list' | 'create' | 'remove'>;
  repoRoot?: string;
  exit?: (code: number) => never;
}

export async function handleWorktree(
  positionals: string[],
  options: WorktreeHandlerOptions = {}
): Promise<boolean> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const wt = options.worktree ?? getWorktreeManager(options.repoRoot);
  const subCmd = positionals[0];
  const args = positionals.slice(1);

  if (!subCmd) {
    console.error('Usage: pacode worktree list|create|remove');
    exit(1);
    return false;
  }

  switch (subCmd) {
    case 'list':
    case 'ls': {
      if (!wt.isGitRepo()) {
        console.error('Not a git repository');
        exit(1);
      }
      const items = wt.list();
      console.log('\nGit Worktrees:');
      if (items.length === 0) {
        console.log(`  ${DIM}No worktrees${RESET}`);
      } else {
        for (const w of items) {
          const label = w.isMain ? `${GREEN}main${RESET}` : `${CYAN}${w.name}${RESET}`;
          console.log(`  ${label} · ${w.branch} · ${w.path}`);
        }
      }
      console.log('');
      return true;
    }

    case 'create': {
      const name = args[0];
      if (!name) {
        console.error('Usage: pacode worktree create <name> [base-branch]');
        exit(1);
        return false;
      }
      const created = wt.create(name, args[1]);
      if (!created) {
        exit(1);
        return false;
      }
      console.log(`${GREEN}✓${RESET} Created worktree ${created.name} at ${created.path}`);
      return true;
    }

    case 'remove':
    case 'rm': {
      const name = args[0];
      if (!name) {
        console.error('Usage: pacode worktree remove <name>');
        exit(1);
        return false;
      }
      if (wt.remove(name)) {
        console.log(`${GREEN}✓${RESET} Removed worktree: ${name}`);
      } else {
        console.log(`${YELLOW}⚠${RESET} Failed to remove: ${name}`);
        exit(1);
      }
      return true;
    }

    default:
      console.error(`Unknown worktree command: ${subCmd}`);
      console.error('Commands: list, create <name> [base], remove <name>');
      return false;
  }
}

export interface CCSwitchHandlerOptions {
  cc?: CCSwitchClient;
  exit?: (code: number) => never;
}

export async function handleCCSwitch(
  positionals: string[],
  options: Record<string, unknown>,
  handlerOptions: CCSwitchHandlerOptions = {}
): Promise<boolean> {
  const exit = handlerOptions.exit ?? ((code: number) => process.exit(code));
  const subCmd = positionals[0];
  if (!subCmd) {
    console.error('Usage: pacode cc-switch list|use|add|remove|...');
    exit(1);
    return false;
  }
  const args = positionals.slice(1);
  const cc = handlerOptions.cc ?? getCCSwitch();

  switch (subCmd) {
    case 'list': {
      const providers = cc.list();
      if (providers.length === 0) {
        console.log('No providers configured.');
        console.log('  pacode cc-switch presets');
        console.log('  pacode cc-switch add deepseek --preset=deepseek --api-key=<key>');
        return true;
      }
      const active = cc.getActive();
      console.log('\nProviders:');
      providers.forEach((p) => {
        const marker = active?.name === p.name ? '●' : '○';
        const model = p.model ? ` (${p.model})` : '';
        const url = p.baseUrl ? ` → ${p.baseUrl}` : '';
        const auth = p.authStyle === 'bearer' ? ' [bearer]' : '';
        const plan =
          p.planMode && p.planMode !== 'api' ? ` [${p.planMode}]` : '';
        console.log(`  ${marker} ${p.name}${model}${auth}${plan}${url}`);
      });
      console.log('');
      return true;
    }

    case 'presets': {
      const planFilter = normalizePlanMode(options.plan as string | undefined);
      console.log(`\n${formatPresetTable(planFilter ? { planMode: planFilter } : undefined)}\n`);
      console.log('Add one:');
      console.log(
        `  pacode cc-switch add <name> --preset=<id> --api-key=<key> [--model=<override>]`
      );
      console.log(
        `  pacode cc-switch presets --plan=token-plan|coding-plan|api`
      );
      console.log(`  pacode cc-switch import --from=cc-switch\n`);
      return true;
    }

    case 'use': {
      const name = (args[0] as string) || (options.name as string);
      if (!name) {
        await cc.interactiveSwitch();
      } else {
        const p = cc.switchTo(name);
        if (p) {
          console.log(`✓ Switched to: ${p.name}`);
          if (p.model) console.log(`  Model: ${p.model}`);
          if (p.baseUrl) console.log(`  Base URL: ${p.baseUrl}`);
          if (p.planMode) console.log(`  Plan: ${p.planMode}`);
          if (p.authStyle) console.log(`  Auth: ${p.authStyle}`);
        } else {
          console.error(`Provider not found: ${name}`);
          exit(1);
        }
      }
      return true;
    }

    case 'add': {
      const planOpt = normalizePlanMode(options.plan as string | undefined);
      const protoOpt = normalizeApiProtocol(options.protocol as string | undefined);
      // --plan=token-plan 且未指定 preset 时默认腾讯 Token Plan
      const presetId =
        (options.preset as string | undefined) ||
        (planOpt === 'token-plan' ? 'tencent-token-plan' : undefined) ||
        (planOpt === 'coding-plan' ? 'glm-coding-plan' : undefined);
      const preset = presetId ? getProviderPreset(presetId) : undefined;
      if (presetId && !preset) {
        console.error(`Unknown preset: ${presetId}`);
        console.error('Run: pacode cc-switch presets');
        exit(1);
        return false;
      }

      const name =
        (args[0] as string) || (options.name as string) || preset?.id;
      if (!name) {
        console.error(
          'Usage: pacode cc-switch add <name> --api-key=<key> [--preset=<id>] [--protocol=openai|anthropic] [--plan=…]'
        );
        exit(1);
        return false;
      }
      const baseUrl =
        (options['base-url'] as string) ||
        preset?.baseUrl ||
        process.env['ANTHROPIC_BASE_URL'] ||
        process.env['OPENAI_BASE_URL'];
      const model =
        (options.model as string) ||
        preset?.model ||
        process.env['CLAUDE_MODEL'] ||
        process.env['OPENAI_MODEL'];
      const authStyle = preset?.authStyle;
      const planMode =
        planOpt ?? preset?.planMode ?? inferPlanModeFromBaseUrl(baseUrl);
      const apiProtocol =
        protoOpt ??
        preset?.apiProtocol ??
        inferApiProtocolFromBaseUrl(baseUrl);

      let apiKey =
        (options['api-key'] as string) ||
        process.env['ANTHROPIC_API_KEY'] ||
        process.env['OPENAI_API_KEY'] ||
        process.env['ANTHROPIC_AUTH_TOKEN'];
      // 本地 Ollama / LM Studio 允许占位 key
      if (!apiKey && apiProtocol === 'openai' && (preset?.id === 'ollama' || preset?.id === 'lmstudio' || baseUrl?.includes('127.0.0.1'))) {
        apiKey = 'ollama';
      }

      if (!apiKey) {
        console.error('--api-key is required (local ollama/lmstudio may omit)');
        exit(1);
        return false;
      }

      cc.addProvider({ name, apiKey, baseUrl, model, authStyle, planMode, apiProtocol });
      console.log(`✓ Added provider: ${name}`);
      if (preset) {
        console.log(`  Preset: ${preset.id} (${preset.label})`);
      }
      console.log(`  Model: ${model}`);
      console.log(`  Base URL: ${baseUrl}`);
      console.log(`  Protocol: ${apiProtocol}`);
      console.log(`  Auth: ${authStyle ?? 'api-key'}`);
      console.log(`  Plan: ${planMode}`);
      console.log(`  Next: pacode cc-switch use ${name}`);
      return true;
    }

    case 'remove': {
      const name = (args[0] as string) || (options.name as string);
      if (!name) {
        console.error('Usage: pacode cc-switch remove <name>');
        exit(1);
        return false;
      }
      if (cc.removeProvider(name)) {
        console.log(`✓ Removed provider: ${name}`);
      } else {
        console.error(`Provider not found: ${name}`);
        exit(1);
        return false;
      }
      return true;
    }

    case 'models-dev': {
      const sub = (args[0] as string | undefined)?.toLowerCase();
      const q = options.q as string | undefined;
      const protocolFilter = normalizeApiProtocol(options.protocol as string | undefined);
      try {
        const catalog = await fetchModelsDevCatalog({
          force: Boolean(options.force),
        });
        if (sub === 'add') {
          const id = (args[1] as string) || (options.name as string);
          if (!id) {
            console.error('Usage: pacode cc-switch models-dev add <provider-id> --api-key=<key> [--model=…]');
            exit(1);
            return false;
          }
          const p = getModelsDevProvider(catalog, id);
          if (!p || !p.protocol) {
            console.error(`Unknown or unsupported models.dev provider: ${id}`);
            console.error('Run: pacode cc-switch models-dev --q=…');
            exit(1);
            return false;
          }
          const draft = modelsDevToProviderDraft(p, {
            model: options.model as string | undefined,
            apiKey:
              (options['api-key'] as string) ||
              process.env['OPENAI_API_KEY'] ||
              process.env['ANTHROPIC_API_KEY'] ||
              '',
          });
          if (!draft.apiKey && draft.apiProtocol === 'openai' && draft.baseUrl?.includes('127.0.0.1')) {
            draft.apiKey = 'ollama';
          }
          if (!draft.apiKey) {
            console.error('--api-key is required for this provider');
            exit(1);
            return false;
          }
          cc.addProvider(draft);
          console.log(`✓ Added from models.dev: ${draft.name}`);
          console.log(`  Protocol: ${draft.apiProtocol}`);
          console.log(`  Model: ${draft.model}`);
          console.log(`  Base URL: ${draft.baseUrl}`);
          console.log(`  Next: pacode cc-switch use ${draft.name}`);
          return true;
        }

        const list = listModelsDevProviders(catalog, {
          protocol: protocolFilter,
          q,
        });
        console.log(`\n${formatModelsDevTable(list)}\n`);
        console.log('Add one:');
        console.log('  pacode cc-switch models-dev add <id> --api-key=<key> [--model=<id>]');
        console.log('  pacode cc-switch models-dev --q=groq --protocol=openai');
        console.log(`  Cache: ~/.paude/cache/models-dev.json (use --force to refresh)\n`);
        return true;
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        exit(1);
        return false;
      }
    }

    case 'import': {
      const fromRaw = (options.from as string | undefined)?.toLowerCase() ?? 'all';
      const from =
        fromRaw === 'claude' || fromRaw === 'cc-switch' || fromRaw === 'cc-switch-cli'
          ? (fromRaw as ImportSourceId)
          : 'all';
      if (
        fromRaw !== 'all' &&
        fromRaw !== 'claude' &&
        fromRaw !== 'cc-switch' &&
        fromRaw !== 'cc-switch-cli'
      ) {
        console.error('Usage: pacode cc-switch import [--from=all|cc-switch|claude|cc-switch-cli]');
        exit(1);
        return false;
      }

      const sources = cc.detectSources();
      if (!sources.ccSwitch && !sources.claudeCode && !sources.ccSwitchCli) {
        console.error('No import sources found.');
        console.error('  Expected ~/.cc-switch/cc-switch.db and/or ~/.claude/settings.json');
        exit(1);
        return false;
      }

      const n = cc.importFromExternal({ from, activateCurrent: true });
      if (n === 0) {
        console.error('Nothing imported (empty or unreadable source).');
        exit(1);
        return false;
      }
      console.log(`✓ Imported ${n} provider(s) into ${cc.getConfigPath()}`);
      const active = cc.getActive();
      if (active) {
        console.log(`  Active: ${active.name}${active.planMode ? ` [${active.planMode}]` : ''}`);
      }
      console.log('  Next: pacode cc-switch list');
      return true;
    }

    case 'status': {
      const active = cc.getActive();
      if (active) {
        console.log(`\nActive provider: ${active.name}`);
        if (active.model) console.log(`  Model: ${active.model}`);
        if (active.baseUrl) console.log(`  Base URL: ${active.baseUrl}`);
        if (active.planMode) console.log(`  Plan: ${active.planMode}`);
        if (active.authStyle) console.log(`  Auth: ${active.authStyle}`);
        if (active.source) console.log(`  Source: ${active.source}`);
        console.log(`  API Key: ${active.apiKey ? `${'*'.repeat(12)} (configured)` : '(missing)'}`);
      } else {
        console.log('\nNo active provider. Use: pacode cc-switch use <name>');
      }
      console.log('');
      return true;
    }

    case 'detect': {
      const sources = cc.detectSources();
      const configPath = cc.getConfigPath();
      console.log('\nProvider detection:');
      console.log(
        `  PaCode providers:  ${sources.pacode ? `${GREEN}✓ found${RESET}` : `${GRAY}○ not found${RESET}`}`
      );
      console.log(
        `  CC Switch:         ${sources.ccSwitch ? `${GREEN}✓ found${RESET}` : `${GRAY}○ not found${RESET}`}`
      );
      console.log(
        `  CC Switch CLI:     ${sources.ccSwitchCli ? `${GREEN}✓ found${RESET}` : `${GRAY}○ not found${RESET}`}`
      );
      console.log(
        `  Claude settings:   ${sources.claudeCode ? `${GREEN}✓ found${RESET}` : `${GRAY}○ not found${RESET}`}`
      );
      if (sources.paths.ccSwitchDb) console.log(`    db: ${sources.paths.ccSwitchDb}`);
      if (sources.paths.claudeSettings) console.log(`    settings: ${sources.paths.claudeSettings}`);
      console.log(`\n  PaCode config: ${configPath}`);
      console.log(`  Import: pacode cc-switch import [--from=cc-switch|claude]\n`);
      return true;
    }

    default:
      console.error(`Unknown cc-switch command: ${subCmd ?? '(none)'}`);
      console.error('Run: pacode --help for usage');
      return false;
  }
}

/** pacode bridge serve [--port N] [--allow-lan] [--token-file path] */
export async function handleBridge(args: string[]): Promise<boolean> {
  const sub = args[0] ?? 'help';
  if (sub === 'serve') {
    const { startSessionRelayServer } = await import('../services/bridge/relay.js');
    let port = 0;
    let allowLan = false;
    let tokenFile: string | undefined;
    let token: string | undefined;
    for (let i = 1; i < args.length; i++) {
      const a = args[i]!;
      if (a === '--allow-lan') allowLan = true;
      else if (a === '--port' && args[i + 1]) {
        port = Number.parseInt(args[++i]!, 10) || 0;
      } else if (a === '--token-file' && args[i + 1]) {
        tokenFile = args[++i];
      } else if (a === '--token' && args[i + 1]) {
        token = args[++i];
      }
    }
    const handle = await startSessionRelayServer({
      port,
      allowLan,
      tokenFile,
      token,
    });
    console.log(`${GREEN}✓${RESET} Bridge relay listening on ${handle.url}`);
    console.log(`${DIM}contract=bridge/v1-local  Ctrl+C to stop${RESET}`);
    await new Promise<void>((resolve) => {
      const stop = () => {
        void handle.close().then(resolve);
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    return true;
  }
  console.log(`Usage:
  pacode bridge serve [--port N] [--allow-lan] [--token TOKEN] [--token-file PATH]

Default bind: 127.0.0.1. Non-loopback requires --allow-lan and a token.
In REPL: /bridge session list|attach <id>
`);
  return sub === 'help';
}
