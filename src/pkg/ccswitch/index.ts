/**
 * Provider switcher — PaCode-owned ~/.paude/providers.json only
 *
 * 不读取 Claude Code ~/.claude/settings.json，也不自动 import CC 配置。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '../defaults.js';

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
  source?: 'pacode';
}

export interface CCSwitchConfig {
  providers: Provider[];
  activeProvider?: string;
}

function pacodeProvidersPath(): string {
  return join(homedir(), '.paude', 'providers.json');
}

export class CCSwitchClient {
  private configPath: string;
  private config: CCSwitchConfig;

  constructor(configPath?: string) {
    this.configPath = configPath ?? pacodeProvidersPath();
    this.config = this.load();
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
    const providers: Provider[] = [];

    if (Array.isArray(config.providers)) {
      for (const p of config.providers) {
        const raw = p as unknown as Record<string, unknown>;
        providers.push({
          name: (p.name ?? (raw['name'] as string) ?? 'unnamed') as string,
          apiKey: (p.apiKey ?? (raw['api_key'] as string) ?? '') as string,
          baseUrl: p.baseUrl ?? (raw['base_url'] as string) ?? (raw['endpoint'] as string),
          model: p.model ?? (raw['model_id'] as string),
          active: p.active,
          source: 'pacode',
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

    if (provider.apiKey) {
      process.env['ANTHROPIC_API_KEY'] = provider.apiKey;
      process.env['PACODE_API_KEY'] = provider.apiKey;
    }
    if (provider.baseUrl) {
      process.env['ANTHROPIC_BASE_URL'] = provider.baseUrl;
      process.env['PACODE_BASE_URL'] = provider.baseUrl;
    }
    if (provider.model) {
      process.env['CLAUDE_MODEL'] = provider.model;
      process.env['PACODE_MODEL'] = provider.model;
    }

    return provider;
  }

  getCredentials(): { apiKey?: string; baseUrl?: string; model?: string } {
    const active = this.getActive();
    const apiKey =
      process.env['PACODE_API_KEY'] ?? process.env['ANTHROPIC_API_KEY'];
    const baseUrl =
      process.env['PACODE_BASE_URL'] ?? process.env['ANTHROPIC_BASE_URL'];
    const model = process.env['PACODE_MODEL'] ?? process.env['CLAUDE_MODEL'];

    if (!active) {
      return { apiKey, baseUrl, model };
    }
    return {
      apiKey: active.apiKey || apiKey,
      baseUrl: active.baseUrl ?? baseUrl,
      model: active.model ?? model,
    };
  }

  /**
   * Claude Code import 已停用 — 保留方法签名以免破坏 handlers，恒返回 0
   */
  importFromClaudeCode(): number {
    return 0;
  }

  /** Claude Code auto-import 已停用 */
  autoImportFromClaudeCode(): Provider | null {
    return null;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  /** 仅探测 PaCode providers；claudeCode 恒为 false（不再依赖） */
  detectSources(): { ccswitch: boolean; claudeCode: boolean; pacode: boolean } {
    return {
      ccswitch: false,
      claudeCode: false,
      pacode: existsSync(pacodeProvidersPath()),
    };
  }

  async interactiveSwitch(): Promise<Provider | null> {
    const providers = this.list();
    if (providers.length === 0) {
      console.log(`\n${YELLOW}⚠  No providers configured${RESET}`);
      console.log(
        `${DIM}Add one: pacode cc-switch add <name> --api-key=<key> --base-url=${DEFAULT_BASE_URL} --model=${DEFAULT_MODEL}${RESET}\n`
      );
      return null;
    }

    const active = this.getActive();
    console.log(`\n${CYAN}${BOLD}  Select Provider${RESET}\n`);

    providers.forEach((p, i) => {
      const isActive = active?.name === p.name;
      const marker = isActive ? `${GREEN}●${RESET}` : `${GRAY}○${RESET}`;
      const label = isActive ? `${BOLD}${p.name}${RESET}` : p.name;
      const model = p.model ? `${DIM}${p.model}${RESET}` : '';
      console.log(`  ${marker} ${CYAN}${i + 1}${RESET}) ${label} ${model}`);
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

export function resetCCSwitch(): void {
  instance = null;
}
