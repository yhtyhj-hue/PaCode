/**
 * Provider switcher — PaCode-owned ~/.paude/providers.json
 *
 * 可显式从 Claude Code / CC Switch 导入；启动时不自动拉取。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import type { ProviderAuthStyle, ProviderPlanMode, ProviderApiProtocol } from './presets.js';
import {
  collectImportableProviders,
  detectImportSources,
  type CollectImportOptions,
  type DetectedImportSources,
} from './import-sources.js';

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
  source?: 'pacode' | 'claude-code' | 'cc-switch';
  /** api-key=x-api-key；bearer=Authorization（豆包 / Token Plan 等） */
  authStyle?: ProviderAuthStyle;
  /** api | token-plan | coding-plan */
  planMode?: ProviderPlanMode;
  /** anthropic Messages | openai Chat Completions */
  apiProtocol?: ProviderApiProtocol;
}

export type { ProviderAuthStyle, ProviderPlanMode, ProviderApiProtocol };
export {
  PROVIDER_PRESETS,
  getProviderPreset,
  listProviderPresets,
  formatPresetTable,
  normalizePlanMode,
  normalizeApiProtocol,
  inferPlanModeFromBaseUrl,
  inferApiProtocolFromBaseUrl,
  type ProviderPreset,
} from './presets.js';
export {
  detectImportSources,
  collectImportableProviders,
  type DetectedImportSources,
  type ImportSourceId,
} from './import-sources.js';

export interface CCSwitchConfig {
  providers: Provider[];
  activeProvider?: string;
}

function pacodeProvidersPath(): string {
  return join(homedir(), '.paude', 'providers.json');
}

function normalizeAuthStyle(raw: unknown): ProviderAuthStyle | undefined {
  if (raw === 'bearer' || raw === 'token' || raw === 'auth-token') return 'bearer';
  if (raw === 'api-key' || raw === 'apiKey' || raw === 'x-api-key') return 'api-key';
  return undefined;
}

function normalizePlanModeField(raw: unknown): ProviderPlanMode | undefined {
  if (raw === 'api' || raw === 'payg' || raw === 'pay-as-you-go') return 'api';
  if (raw === 'token-plan' || raw === 'token_plan' || raw === 'tokenplan') return 'token-plan';
  if (raw === 'coding-plan' || raw === 'coding_plan' || raw === 'coding') return 'coding-plan';
  return undefined;
}

function normalizeProtocolField(raw: unknown): ProviderApiProtocol | undefined {
  if (raw === 'openai' || raw === 'openai-compatible' || raw === 'chat') return 'openai';
  if (raw === 'anthropic' || raw === 'messages') return 'anthropic';
  return undefined;
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
        const sourceRaw = p.source ?? (raw['source'] as string);
        const source =
          sourceRaw === 'claude-code' || sourceRaw === 'cc-switch' || sourceRaw === 'pacode'
            ? sourceRaw
            : 'pacode';
        providers.push({
          name: (p.name ?? (raw['name'] as string) ?? 'unnamed') as string,
          apiKey: (p.apiKey ?? (raw['api_key'] as string) ?? '') as string,
          baseUrl: p.baseUrl ?? (raw['base_url'] as string) ?? (raw['endpoint'] as string),
          model: p.model ?? (raw['model_id'] as string),
          active: p.active,
          source,
          authStyle: normalizeAuthStyle(
            p.authStyle ?? (raw['auth_style'] as string) ?? (raw['authStyle'] as string)
          ),
          planMode: normalizePlanModeField(
            p.planMode ?? (raw['plan_mode'] as string) ?? (raw['planMode'] as string)
          ),
          apiProtocol: normalizeProtocolField(
            p.apiProtocol ?? (raw['api_protocol'] as string) ?? (raw['apiProtocol'] as string)
          ),
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
    const next = { ...provider, source: provider.source ?? 'pacode' };
    if (idx >= 0) {
      this.config.providers[idx] = next;
    } else {
      this.config.providers.push(next);
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
    if (provider.planMode) {
      process.env['PACODE_PLAN_MODE'] = provider.planMode;
    }
    const proto =
      provider.apiProtocol ??
      (provider.baseUrl?.includes(':11434') || provider.baseUrl?.includes('openai.com')
        ? 'openai'
        : 'anthropic');
    process.env['PACODE_API_PROTOCOL'] = proto;
    if (provider.authStyle === 'bearer' || provider.planMode === 'token-plan' || provider.planMode === 'coding-plan') {
      process.env['PACODE_AUTH_STYLE'] = 'bearer';
      if (provider.apiKey) process.env['ANTHROPIC_AUTH_TOKEN'] = provider.apiKey;
    } else {
      process.env['PACODE_AUTH_STYLE'] = 'api-key';
      delete process.env['ANTHROPIC_AUTH_TOKEN'];
    }

    return provider;
  }

  getCredentials(): {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    authStyle?: ProviderAuthStyle;
    planMode?: ProviderPlanMode;
    apiProtocol?: ProviderApiProtocol;
  } {
    const active = this.getActive();
    const apiKey =
      process.env['PACODE_API_KEY'] ??
      process.env['ANTHROPIC_API_KEY'] ??
      process.env['OPENAI_API_KEY'] ??
      process.env['ANTHROPIC_AUTH_TOKEN'];
    const baseUrl =
      process.env['PACODE_BASE_URL'] ??
      process.env['ANTHROPIC_BASE_URL'] ??
      process.env['OPENAI_BASE_URL'];
    const model = process.env['PACODE_MODEL'] ?? process.env['CLAUDE_MODEL'] ?? process.env['OPENAI_MODEL'];
    const envAuth = normalizeAuthStyle(process.env['PACODE_AUTH_STYLE']);
    const envPlan = normalizePlanModeField(process.env['PACODE_PLAN_MODE']);
    const envProto = normalizeProtocolField(process.env['PACODE_API_PROTOCOL']);

    if (!active) {
      return {
        apiKey,
        baseUrl,
        model,
        authStyle: envAuth,
        planMode: envPlan,
        apiProtocol: envProto,
      };
    }
    return {
      apiKey: active.apiKey || apiKey,
      baseUrl: active.baseUrl ?? baseUrl,
      model: active.model ?? model,
      authStyle: active.authStyle ?? envAuth,
      planMode: active.planMode ?? envPlan,
      apiProtocol: active.apiProtocol ?? envProto,
    };
  }

  /**
   * 从 Claude Code / CC Switch 导入到 ~/.paude/providers.json
   * @returns 新写入或更新的数量
   */
  importFromExternal(options: CollectImportOptions & { activateCurrent?: boolean } = {}): number {
    const imported = collectImportableProviders(options);
    if (imported.length === 0) return 0;

    let count = 0;
    let activateName: string | undefined;
    for (const p of imported) {
      const existing = this.config.providers.find((x) => x.name === p.name);
      this.addProvider({
        ...existing,
        ...p,
        apiKey: p.apiKey || existing?.apiKey || '',
        source: p.source ?? 'pacode',
      });
      count += 1;
      if (p.active) activateName = p.name;
    }

    if (options.activateCurrent !== false && activateName) {
      this.switchTo(activateName);
    } else {
      this.save();
    }
    return count;
  }

  /** @deprecated 使用 importFromExternal；保留兼容 */
  importFromClaudeCode(): number {
    return this.importFromExternal({ from: 'claude', activateCurrent: false });
  }

  /** 不自动导入 — 启动时永不偷偷拉外部配置 */
  autoImportFromClaudeCode(): Provider | null {
    return null;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  detectSources(): DetectedImportSources {
    return detectImportSources(existsSync(this.configPath));
  }

  async interactiveSwitch(): Promise<Provider | null> {
    const providers = this.list();
    if (providers.length === 0) {
      console.log(`\n${YELLOW}⚠  No providers configured${RESET}`);
      console.log(
        `${DIM}Add: pacode cc-switch add --preset=tencent-token-plan --api-key=<key>${RESET}`
      );
      console.log(
        `${DIM}Or:  pacode cc-switch import   # from CC Switch / Claude settings${RESET}\n`
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
      const plan = p.planMode && p.planMode !== 'api' ? `${DIM}[${p.planMode}]${RESET}` : '';
      console.log(`  ${marker} ${CYAN}${i + 1}${RESET}) ${label} ${model} ${plan}`);
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
