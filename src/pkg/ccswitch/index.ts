/**
 * CC-Switch Integration
 *
 * Connects to Claude Code Switch (ccswitch.io / farion1231/cc-switch) for unified
 * API provider management. Reads configs from both:
 * 1. CC-Switch app's own SQLite database location
 * 2. ~/.claude/settings.json (Claude Code's standard config)
 * 3. PaCode's own ~/.paude/providers.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { createInterface } from 'node:readline';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';

export interface Provider {
  name: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  active?: boolean;
  source?: 'ccswitch' | 'claude-code' | 'pacode';
}

export interface CCSwitchConfig {
  providers: Provider[];
  activeProvider?: string;
}

export class CCSwitchClient {
  private configPath: string;
  private config: CCSwitchConfig;

  constructor(configPath?: string) {
    // Try CC-Switch's default locations first, fallback to PaCode's
    this.configPath = configPath ?? this.findCCSwitchConfig();
    this.config = this.load();
  }

  /**
   * Find CC-Switch configuration file based on platform
   * CC-Switch (farion1231/cc-switch) stores its database here:
   * - macOS: ~/Library/Application Support/cc-switch/config.json
   * - Linux: ~/.config/cc-switch/config.json
   * - Windows: %APPDATA%/cc-switch/config.json
   */
  private findCCSwitchConfig(): string {
    const home = homedir();
    const plat = platform();
    const candidates: string[] = [];

    // CC-Switch's own config
    if (plat === 'darwin') {
      candidates.push(join(home, 'Library/Application Support/cc-switch/config.json'));
    } else if (plat === 'linux') {
      candidates.push(join(home, '.config/cc-switch/config.json'));
    } else if (plat === 'win32') {
      candidates.push(join(process.env['APPDATA'] ?? '', 'cc-switch/config.json'));
    }

    // Claude Code's standard config
    candidates.push(join(home, '.claude', 'settings.json'));

    // PaCode's own config
    candidates.push(join(home, '.paude', 'providers.json'));

    for (const path of candidates) {
      if (existsSync(path)) {
        return path;
      }
    }

    // Default to PaCode's path
    return join(home, '.paude', 'providers.json');
  }

  private load(): CCSwitchConfig {
    if (existsSync(this.configPath)) {
      try {
        const content = readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(content);
        return this.normalize(parsed);
      } catch {
        // ignore
      }
    }
    return { providers: [] };
  }

  private normalize(config: CCSwitchConfig): CCSwitchConfig {
    // Normalize various CC-Switch config formats
    const providers: Provider[] = [];

    // Handle different config schemas
    if (Array.isArray(config.providers)) {
      for (const p of config.providers) {
        const raw = p as unknown as Record<string, unknown>;
        providers.push({
          name: (p.name ?? (raw['name'] as string) ?? 'unnamed') as string,
          apiKey: (p.apiKey ?? (raw['api_key'] as string) ?? '') as string,
          baseUrl: p.baseUrl ?? (raw['base_url'] as string) ?? (raw['endpoint'] as string),
          model: p.model ?? (raw['model_id'] as string),
          active: p.active,
          source: p.source ?? 'ccswitch',
        });
      }
    }

    const raw = config as unknown as Record<string, unknown>;
    return {
      providers,
      activeProvider: config.activeProvider ?? (raw['current_provider'] as string),
    };
  }

  private save(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  list(): Provider[] {
    return this.config.providers;
  }

  getActive(): Provider | undefined {
    if (this.config.activeProvider) {
      return this.config.providers.find((p) => p.name === this.config.activeProvider);
    }
    return this.config.providers.find((p) => p.active);
  }

  addProvider(provider: Provider): void {
    const idx = this.config.providers.findIndex((p) => p.name === provider.name);
    if (idx >= 0) {
      this.config.providers[idx] = { ...provider, source: 'pacode' };
    } else {
      this.config.providers.push({ ...provider, source: 'pacode' });
    }
    this.save();
  }

  /** 删除 provider；若删除的是当前激活项则切换到第一个剩余项 */
  removeProvider(name: string): boolean {
    const idx = this.config.providers.findIndex((p) => p.name === name);
    if (idx < 0) return false;

    this.config.providers.splice(idx, 1);

    if (this.config.activeProvider === name) {
      const next = this.config.providers[0];
      this.config.activeProvider = next?.name;
      this.config.providers.forEach((p) => {
        p.active = p.name === next?.name;
      });
    }

    this.save();
    return true;
  }

  switchTo(name: string): Provider | null {
    const provider = this.config.providers.find((p) => p.name === name);
    if (!provider) return null;

    this.config.providers.forEach((p) => {
      p.active = false;
    });
    provider.active = true;
    this.config.activeProvider = name;
    this.save();

    // Apply to current process environment
    if (provider.apiKey) process.env['ANTHROPIC_API_KEY'] = provider.apiKey;
    if (provider.baseUrl) process.env['ANTHROPIC_BASE_URL'] = provider.baseUrl;
    if (provider.model) process.env['CLAUDE_MODEL'] = provider.model;

    return provider;
  }

  getCredentials(): { apiKey?: string; baseUrl?: string; model?: string } {
    const active = this.getActive();
    if (!active) {
      return {
        apiKey: process.env['ANTHROPIC_API_KEY'],
        baseUrl: process.env['ANTHROPIC_BASE_URL'],
        model: process.env['CLAUDE_MODEL'],
      };
    }
    return {
      apiKey: active.apiKey ?? process.env['ANTHROPIC_API_KEY'],
      baseUrl: active.baseUrl ?? process.env['ANTHROPIC_BASE_URL'],
      model: active.model ?? process.env['CLAUDE_MODEL'],
    };
  }

  /**
   * Import providers from Claude Code's standard config (~/.claude/settings.json)
   */
  importFromClaudeCode(): number {
    const claudeConfigPath = join(homedir(), '.claude', 'settings.json');
    if (!existsSync(claudeConfigPath)) return 0;

    try {
      const content = readFileSync(claudeConfigPath, 'utf-8');
      const settings = JSON.parse(content);
      const env = settings.env ?? {};
      let imported = 0;

      // Claude Code uses ANTHROPIC_AUTH_TOKEN (not ANTHROPIC_API_KEY)
      // Both are supported
      const apiKey = env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY;
      if (apiKey) {
        const model =
          env.ANTHROPIC_MODEL ?? env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? 'claude-sonnet-4-0';
        const name = `claude-code-${model.split('-').slice(0, 2).join('-')}`;
        this.addProvider({
          name,
          apiKey,
          baseUrl: env.ANTHROPIC_BASE_URL,
          model,
          active: true,
          source: 'claude-code',
        });
        this.config.activeProvider = name;
        imported++;
      }

      this.save();
      return imported;
    } catch {
      return 0;
    }
  }

  /**
   * Auto-import and activate from Claude Code config if no providers exist
   */
  autoImportFromClaudeCode(): Provider | null {
    const claudeConfigPath = join(homedir(), '.claude', 'settings.json');
    if (!existsSync(claudeConfigPath)) return null;

    try {
      const content = readFileSync(claudeConfigPath, 'utf-8');
      const settings = JSON.parse(content);
      const env = settings.env ?? {};

      const apiKey = env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY;
      if (!apiKey) return null;

      const model =
        env.ANTHROPIC_MODEL ?? env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? 'claude-sonnet-4-0';
      const name = `claude-code-${model.split('-').slice(0, 2).join('-')}`;

      // Add and switch
      this.addProvider({
        name,
        apiKey,
        baseUrl: env.ANTHROPIC_BASE_URL,
        model,
        active: true,
        source: 'claude-code',
      });
      this.config.activeProvider = name;
      this.save();

      // Apply to env
      if (env.ANTHROPIC_BASE_URL) process.env['ANTHROPIC_BASE_URL'] = env.ANTHROPIC_BASE_URL;
      if (apiKey) process.env['ANTHROPIC_API_KEY'] = apiKey;
      if (model) process.env['CLAUDE_MODEL'] = model;

      return this.getActive() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get the config path being used (for debugging)
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Detect which sources are available
   */
  detectSources(): { ccswitch: boolean; claudeCode: boolean; pacode: boolean } {
    const home = homedir();
    const plat = platform();

    let ccswitchPath = '';
    if (plat === 'darwin')
      ccswitchPath = join(home, 'Library/Application Support/cc-switch/config.json');
    else if (plat === 'linux') ccswitchPath = join(home, '.config/cc-switch/config.json');
    else if (plat === 'win32')
      ccswitchPath = join(process.env['APPDATA'] ?? '', 'cc-switch/config.json');

    return {
      ccswitch: existsSync(ccswitchPath),
      claudeCode: existsSync(join(home, '.claude', 'settings.json')),
      pacode: existsSync(join(home, '.paude', 'providers.json')),
    };
  }

  async interactiveSwitch(): Promise<Provider | null> {
    const providers = this.list();
    if (providers.length === 0) {
      console.log(`\n${YELLOW}⚠  No providers configured${RESET}`);
      console.log(`${DIM}Add one: pacode cc-switch add <name> --api-key=<key>${RESET}\n`);
      return null;
    }

    const active = this.getActive();
    console.log(`\n${CYAN}${BOLD}  Select Provider${RESET}\n`);

    providers.forEach((p, i) => {
      const isActive = active?.name === p.name;
      const marker = isActive ? `${GREEN}●${RESET}` : `${GRAY}○${RESET}`;
      const label = isActive ? `${BOLD}${p.name}${RESET}` : p.name;
      const model = p.model ? `${DIM}${p.model}${RESET}` : '';
      const sourceTag = p.source && p.source !== 'pacode' ? `${YELLOW}[${p.source}]${RESET}` : '';
      console.log(`  ${marker} ${CYAN}${i + 1}${RESET}) ${label} ${model} ${sourceTag}`);
    });

    console.log(`\n${DIM}Enter number (1-${providers.length}):${RESET} `);

    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.on('line', (input: string) => {
        const idx = parseInt(input.trim(), 10) - 1;
        rl.close();
        if (idx >= 0 && idx < providers.length) {
          const p = providers[idx];
          if (p) {
            const result = this.switchTo(p.name);
            console.log(`\n${GREEN}✓ Switched to ${p.name}${RESET}\n`);
            resolve(result);
            return;
          }
        }
        console.log(`${RED}Invalid selection${RESET}`);
        resolve(null);
      });
    });
  }
}

let instance: CCSwitchClient | null = null;
export function getCCSwitch(): CCSwitchClient {
  if (!instance) instance = new CCSwitchClient();
  return instance;
}
