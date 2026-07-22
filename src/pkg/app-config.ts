/**
 * App Config — 统一合并 config / settings / providers / CLI flags
 *
 * 不读取 Claude Code ~/.claude/settings.json。
 */

import { PermissionMode } from './types.js';
import { DEFAULT_MODEL, DEFAULT_MAX_TOKENS, DEFAULT_BASE_URL } from './defaults.js';
import { loadConfig, PaudeConfig, resetConfigCache } from './config/index.js';
import { getSettingsManager, PaCodeSettings, SettingsManager } from './settings/index.js';
import { getCCSwitch } from './ccswitch/index.js';
import { PermissionRules } from '../permission/rules.js';
import {
  normalizePrefetchIntents,
  PrefetchRuntimeConfig,
} from '../agent/prefetch-config.js';
import type { ToolIntent } from '../services/agent-scheduler/types.js';

export interface AppConfigCliOverrides {
  mode?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  /** CLI: --no-prefetch */
  prefetchEnabled?: boolean;
}

export interface ResolvedAppConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
  mode: PermissionMode;
  contextMaxTokens: number;
  compactionThreshold: number;
  permissions?: PermissionRules;
  prefetch: PrefetchRuntimeConfig;
}

const MODE_MAP: Record<string, PermissionMode> = {
  plan: PermissionMode.PLAN,
  default: PermissionMode.DEFAULT,
  acceptEdits: PermissionMode.ACCEPT_EDITS,
  auto: PermissionMode.AUTO,
  dontAsk: PermissionMode.DONT_ASK,
  bypass: PermissionMode.BYPASS,
  bypassPermissions: PermissionMode.BYPASS,
  bubble: PermissionMode.BUBBLE,
};

function resolveMode(value?: string): PermissionMode | undefined {
  if (!value) return undefined;
  return MODE_MAP[value] ?? PermissionMode.DEFAULT;
}

/** PACODE_* 优先于 CLAUDE_* / ANTHROPIC_* 环境别名 */
function envModel(): string | undefined {
  return process.env['PACODE_MODEL'] ?? process.env['CLAUDE_MODEL'];
}

function envApiKey(): string | undefined {
  return process.env['PACODE_API_KEY'] ?? process.env['ANTHROPIC_API_KEY'];
}

function envBaseUrl(): string | undefined {
  return process.env['PACODE_BASE_URL'] ?? process.env['ANTHROPIC_BASE_URL'];
}

/** 合并三层配置，CLI flags 优先级最高 */
export function resolveAppConfig(
  cli: AppConfigCliOverrides = {},
  options: { configPath?: string; settingsManager?: SettingsManager } = {}
): ResolvedAppConfig {
  resetConfigCache();
  const paude: PaudeConfig = loadConfig(options.configPath);
  const settings: PaCodeSettings = (options.settingsManager ?? getSettingsManager()).load();
  const creds = getCCSwitch().getCredentials();

  const mode =
    resolveMode(cli.mode) ??
    settings.mode ??
    paude.permission.mode ??
    PermissionMode.DEFAULT;

  const prefetchEnabled =
    cli.prefetchEnabled ?? paude.prefetch.enabled ?? true;
  const prefetchIntents = normalizePrefetchIntents(
    paude.prefetch.intents as string[] | undefined
  ) as ToolIntent[] | undefined;

  return {
    model:
      cli.model ??
      settings.model ??
      paude.model.model ??
      creds.model ??
      envModel() ??
      DEFAULT_MODEL,
    apiKey:
      cli.apiKey ?? settings.apiKey ?? paude.model.apiKey ?? creds.apiKey ?? envApiKey(),
    baseUrl:
      cli.baseUrl ??
      settings.baseUrl ??
      paude.model.baseUrl ??
      creds.baseUrl ??
      envBaseUrl() ??
      DEFAULT_BASE_URL,
    maxTokens: cli.maxTokens ?? settings.maxTokens ?? paude.model.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: cli.temperature ?? settings.temperature ?? paude.model.temperature,
    mode,
    contextMaxTokens: paude.context.maxTokens,
    compactionThreshold: paude.context.compactionThreshold,
    permissions: settings.permissions,
    prefetch: {
      enabled: prefetchEnabled,
      intents: prefetchIntents,
    },
  };
}

/** 供文档/测试引用的默认值 */
export { DEFAULT_MODEL, DEFAULT_MAX_TOKENS, DEFAULT_BASE_URL };

export { resolveMode, MODE_MAP };
