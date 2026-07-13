/**
 * App Config — 统一合并 config / settings / cc-switch / CLI flags
 */

import { PermissionMode } from './types.js';
import { loadConfig, PaudeConfig, resetConfigCache } from './config/index.js';
import { getSettingsManager, PaCodeSettings, SettingsManager } from './settings/index.js';
import { getCCSwitch } from './ccswitch/index.js';
import { PermissionRules } from '../permission/rules.js';

export interface AppConfigCliOverrides {
  mode?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
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

  return {
    model: cli.model ?? settings.model ?? paude.model.model ?? creds.model,
    apiKey: cli.apiKey ?? settings.apiKey ?? paude.model.apiKey ?? creds.apiKey,
    baseUrl: cli.baseUrl ?? settings.baseUrl ?? paude.model.baseUrl ?? creds.baseUrl,
    maxTokens: cli.maxTokens ?? settings.maxTokens ?? paude.model.maxTokens,
    temperature: cli.temperature ?? settings.temperature ?? paude.model.temperature,
    mode,
    contextMaxTokens: paude.context.maxTokens,
    compactionThreshold: paude.context.compactionThreshold,
    permissions: settings.permissions,
  };
}

export { resolveMode, MODE_MAP };
