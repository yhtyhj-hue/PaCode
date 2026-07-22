/**
 * 从 Claude Code / CC Switch 导入 provider 配置（显式 import，不自动启动时拉取）
 *
 * 支持源：
 * 1. ~/.claude/settings.json（env 块）
 * 2. ~/.cc-switch/cc-switch.db（farion1231/CC Switch 桌面端）
 * 3. ~/.cc-switch/config.json（旧版 JSON SSOT，若存在）
 * 4. ~/.cc-switch-cli/store.json（cc-switch-cli）
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Provider } from './index.js';
import {
  inferPlanModeFromBaseUrl,
  normalizePlanMode,
  type ProviderAuthStyle,
  type ProviderPlanMode,
} from './presets.js';

const require = createRequire(import.meta.url);

export type ImportSourceId = 'claude' | 'cc-switch' | 'cc-switch-cli';

export interface DetectedImportSources {
  claudeCode: boolean;
  ccSwitch: boolean;
  ccSwitchCli: boolean;
  pacode: boolean;
  paths: {
    claudeSettings?: string;
    ccSwitchDb?: string;
    ccSwitchConfig?: string;
    ccSwitchCliStore?: string;
    pacodeProviders?: string;
  };
}

function claudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function ccSwitchDbPath(): string {
  return join(homedir(), '.cc-switch', 'cc-switch.db');
}

function ccSwitchConfigPath(): string {
  return join(homedir(), '.cc-switch', 'config.json');
}

function ccSwitchCliStorePath(): string {
  return join(homedir(), '.cc-switch-cli', 'store.json');
}

function pacodeProvidersPath(): string {
  return join(homedir(), '.paude', 'providers.json');
}

export function detectImportSources(
  pacodeConfigExists = existsSync(pacodeProvidersPath())
): DetectedImportSources {
  const claude = claudeSettingsPath();
  const db = ccSwitchDbPath();
  const cfg = ccSwitchConfigPath();
  const cli = ccSwitchCliStorePath();
  return {
    claudeCode: existsSync(claude),
    ccSwitch: existsSync(db) || existsSync(cfg),
    ccSwitchCli: existsSync(cli),
    pacode: pacodeConfigExists,
    paths: {
      claudeSettings: existsSync(claude) ? claude : undefined,
      ccSwitchDb: existsSync(db) ? db : undefined,
      ccSwitchConfig: existsSync(cfg) ? cfg : undefined,
      ccSwitchCliStore: existsSync(cli) ? cli : undefined,
      pacodeProviders: pacodeConfigExists ? pacodeProvidersPath() : undefined,
    },
  };
}

function pickModel(env: Record<string, unknown>): string | undefined {
  const keys = [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
    'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'CLAUDE_MODEL',
  ];
  for (const k of keys) {
    const v = env[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function pickKey(env: Record<string, unknown>): {
  apiKey?: string;
  authStyle?: ProviderAuthStyle;
} {
  const token =
    typeof env['ANTHROPIC_AUTH_TOKEN'] === 'string'
      ? env['ANTHROPIC_AUTH_TOKEN'].trim()
      : '';
  const apiKey =
    typeof env['ANTHROPIC_API_KEY'] === 'string'
      ? env['ANTHROPIC_API_KEY'].trim()
      : typeof env['PACODE_API_KEY'] === 'string'
        ? env['PACODE_API_KEY'].trim()
        : '';
  if (token && token !== 'PROXY_MANAGED') {
    return { apiKey: token, authStyle: 'bearer' };
  }
  if (apiKey && apiKey !== 'PROXY_MANAGED') {
    return { apiKey, authStyle: 'api-key' };
  }
  // 本地代理占位：仍导入 URL/model，key 留空让用户补
  if (token === 'PROXY_MANAGED' || apiKey === 'PROXY_MANAGED') {
    return { apiKey: undefined, authStyle: token ? 'bearer' : 'api-key' };
  }
  return {};
}

function envToProvider(
  name: string,
  env: Record<string, unknown>,
  source: Provider['source'],
  extras?: { planMode?: ProviderPlanMode; active?: boolean }
): Provider | null {
  const baseUrl =
    typeof env['ANTHROPIC_BASE_URL'] === 'string'
      ? env['ANTHROPIC_BASE_URL'].trim()
      : typeof env['PACODE_BASE_URL'] === 'string'
        ? env['PACODE_BASE_URL'].trim()
        : undefined;
  const { apiKey, authStyle } = pickKey(env);
  const model = pickModel(env);
  if (!baseUrl && !apiKey && !model) return null;

  const planFromEnv = normalizePlanMode(env['PACODE_PLAN_MODE'] ?? env['PLAN_MODE']);
  const planMode =
    extras?.planMode ?? planFromEnv ?? inferPlanModeFromBaseUrl(baseUrl);

  return {
    name,
    apiKey: apiKey ?? '',
    baseUrl,
    model,
    authStyle: authStyle ?? (planMode !== 'api' ? 'bearer' : 'api-key'),
    planMode,
    source,
    active: extras?.active,
  };
}

/** 解析 Claude Code settings.json → 单个 provider */
export function parseClaudeSettingsProviders(
  settingsPath = claudeSettingsPath()
): Provider[] {
  if (!existsSync(settingsPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      env?: Record<string, unknown>;
      model?: string;
    };
    const env = { ...(raw.env ?? {}) };
    if (raw.model && !env['ANTHROPIC_MODEL']) {
      env['ANTHROPIC_MODEL'] = raw.model;
    }
    const p = envToProvider('claude-settings', env, 'claude-code');
    return p ? [p] : [];
  } catch {
    return [];
  }
}

interface CcSwitchDbRow {
  id: string;
  name: string;
  settings_config: string;
  is_current: number | boolean;
  category?: string | null;
  notes?: string | null;
}

function parseSettingsConfigJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as { env?: Record<string, unknown> };
    return parsed.env ?? (parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

function planFromCcCategory(category?: string | null, notes?: string | null): ProviderPlanMode | undefined {
  const blob = `${category ?? ''} ${notes ?? ''}`.toLowerCase();
  if (blob.includes('token') && blob.includes('plan')) return 'token-plan';
  if (blob.includes('coding') || blob.includes('code plan')) return 'coding-plan';
  return undefined;
}

/** 通过 node:sqlite 或 sqlite3 CLI 读 CC Switch DB */
export function readCcSwitchDbProviders(dbPath = ccSwitchDbPath()): Provider[] {
  if (!existsSync(dbPath)) return [];
  const rows = queryCcSwitchProviders(dbPath);
  const out: Provider[] = [];
  for (const row of rows) {
    const env = parseSettingsConfigJson(row.settings_config);
    const planHint = planFromCcCategory(row.category, row.notes);
    const p = envToProvider(row.name || row.id, env, 'cc-switch', {
      active: Boolean(row.is_current),
      planMode: planHint ?? inferPlanModeFromBaseUrl(
        typeof env['ANTHROPIC_BASE_URL'] === 'string' ? env['ANTHROPIC_BASE_URL'] : undefined
      ),
    });
    if (p) out.push(p);
  }
  return out;
}

function queryCcSwitchProviders(dbPath: string): CcSwitchDbRow[] {
  const sql =
    "SELECT id, name, settings_config, is_current, category, notes FROM providers WHERE app_type = 'claude'";

  // Node 22.5+ / 24：内置 node:sqlite
  try {
    const mod = require('node:sqlite') as {
      DatabaseSync: new (
        path: string,
        opts?: { readOnly?: boolean }
      ) => {
        prepare: (s: string) => { all: (...a: unknown[]) => CcSwitchDbRow[] };
        close: () => void;
      };
    };
    const db = new mod.DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(sql).all() as CcSwitchDbRow[];
    } finally {
      db.close();
    }
  } catch {
    // fall through
  }

  // 回退：系统 sqlite3 CLI（-json）
  try {
    const out = execFileSync('sqlite3', ['-json', dbPath, sql], {
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
    });
    if (!out.trim()) return [];
    return JSON.parse(out) as CcSwitchDbRow[];
  } catch {
    return [];
  }
}

/** 旧版 ~/.cc-switch/config.json */
export function parseCcSwitchConfigJson(
  configPath = ccSwitchConfigPath()
): Provider[] {
  if (!existsSync(configPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      providers?: Array<Record<string, unknown>>;
      currentProviderClaude?: string;
      current?: string;
    };
    const list = Array.isArray(raw.providers) ? raw.providers : [];
    const current = raw.currentProviderClaude ?? raw.current;
    const out: Provider[] = [];
    for (const item of list) {
      const name = String(item['name'] ?? item['id'] ?? 'unnamed');
      const settings =
        typeof item['settingsConfig'] === 'string'
          ? parseSettingsConfigJson(item['settingsConfig'])
          : typeof item['settings_config'] === 'string'
            ? parseSettingsConfigJson(item['settings_config'])
            : ((item['env'] as Record<string, unknown>) ?? item);
      const p = envToProvider(name, settings, 'cc-switch', {
        active: item['id'] === current || item['name'] === current || Boolean(item['isCurrent']),
      });
      if (p) out.push(p);
    }
    return out;
  } catch {
    return [];
  }
}

/** ~/.cc-switch-cli/store.json */
export function parseCcSwitchCliStore(
  storePath = ccSwitchCliStorePath()
): Provider[] {
  if (!existsSync(storePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(storePath, 'utf-8')) as {
      providers?: Array<Record<string, unknown>>;
      current?: string;
      active?: string;
    };
    const list = Array.isArray(raw.providers) ? raw.providers : [];
    const current = raw.current ?? raw.active;
    const out: Provider[] = [];
    for (const item of list) {
      const name = String(item['name'] ?? item['id'] ?? 'unnamed');
      const env =
        (item['env'] as Record<string, unknown>) ??
        ({
          ANTHROPIC_API_KEY: item['apiKey'] ?? item['api_key'],
          ANTHROPIC_AUTH_TOKEN: item['authToken'] ?? item['auth_token'],
          ANTHROPIC_BASE_URL: item['baseUrl'] ?? item['base_url'],
          ANTHROPIC_MODEL: item['model'],
        } as Record<string, unknown>);
      const p = envToProvider(name, env, 'cc-switch', {
        active: name === current || item['id'] === current,
      });
      if (p) out.push(p);
    }
    return out;
  } catch {
    return [];
  }
}

export interface CollectImportOptions {
  from?: ImportSourceId | 'all';
}

/** 汇总可导入 provider（不落盘） */
export function collectImportableProviders(
  options: CollectImportOptions = {}
): Provider[] {
  const from = options.from ?? 'all';
  const byName = new Map<string, Provider>();

  const addAll = (list: Provider[]) => {
    for (const p of list) {
      const key = p.name.toLowerCase();
      const prev = byName.get(key);
      // 后者覆盖；优先保留有 key 的
      if (!prev || (p.apiKey && !prev.apiKey) || from !== 'all') {
        byName.set(key, p);
      } else if (!byName.has(key)) {
        byName.set(key, p);
      } else {
        byName.set(key, { ...prev, ...p, apiKey: p.apiKey || prev.apiKey });
      }
    }
  };

  if (from === 'all' || from === 'cc-switch') {
    addAll(readCcSwitchDbProviders());
    addAll(parseCcSwitchConfigJson());
  }
  if (from === 'all' || from === 'cc-switch-cli') {
    addAll(parseCcSwitchCliStore());
  }
  if (from === 'all' || from === 'claude') {
    addAll(parseClaudeSettingsProviders());
  }

  return [...byName.values()];
}
