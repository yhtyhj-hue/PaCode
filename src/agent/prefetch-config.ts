/**
 * Prefetch 开关 — 配置 / 环境变量（H1）
 *
 * PACODE_PREFETCH=0|false|off 强制关闭。
 * config.prefetch.enabled=false 关闭。
 * config.prefetch.intents 非空时仅对这些 intent 预取。
 */

import type { ToolIntent } from '../services/agent-scheduler/types.js';

export interface PrefetchRuntimeConfig {
  enabled: boolean;
  /** 空 = 全部 intent 可预取 */
  intents?: ToolIntent[];
}

const ALL_INTENTS: ToolIntent[] = [
  'inspect_project',
  'review_implementation',
  'code_audit',
  'run_tests',
];

export function parsePrefetchEnv(env: NodeJS.ProcessEnv = process.env): boolean | undefined {
  const raw = env['PACODE_PREFETCH']?.trim().toLowerCase();
  if (raw === undefined || raw === '') return undefined;
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true;
  return undefined;
}

export function normalizePrefetchIntents(raw?: string[]): ToolIntent[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const allowed = new Set<string>(ALL_INTENTS);
  const out = raw.filter((i): i is ToolIntent => allowed.has(i));
  return out.length > 0 ? out : undefined;
}

/** 是否应对该 intent 运行 L1 预取 */
export function shouldRunPrefetch(
  cfg: PrefetchRuntimeConfig,
  intent: ToolIntent,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const envOverride = parsePrefetchEnv(env);
  const enabled = envOverride !== undefined ? envOverride : cfg.enabled;
  if (!enabled) return false;
  if (cfg.intents && cfg.intents.length > 0) {
    return cfg.intents.includes(intent);
  }
  return true;
}
