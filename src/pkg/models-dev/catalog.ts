/**
 * Models.dev 目录 — 拉取 / 缓存 / 筛选 OpenAI-compatible 与 Anthropic 兼容提供商
 *
 * 目录：https://models.dev/api.json
 * PaCode 仅对接两种协议：anthropic Messages、openai Chat Completions。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { ProviderAuthStyle, ProviderPlanMode } from '../ccswitch/presets.js';

export const MODELS_DEV_API = 'https://models.dev/api.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type ModelsDevApiProtocol = 'anthropic' | 'openai';

export interface ModelsDevModel {
  id: string;
  name?: string;
  tool_call?: boolean;
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  npm?: string;
  api?: string;
  env?: string[];
  doc?: string;
  models: ModelsDevModel[];
  /** 映射到 PaCode 的协议；无法映射则为 null */
  protocol: ModelsDevApiProtocol | null;
}

export interface ModelsDevCacheFile {
  fetchedAt: number;
  source: string;
  providers: ModelsDevProvider[];
}

function cachePath(): string {
  return join(homedir(), '.paude', 'cache', 'models-dev.json');
}

function resolveProtocol(npm?: string, api?: string): ModelsDevApiProtocol | null {
  const n = npm ?? '';
  if (n.includes('anthropic')) return 'anthropic';
  if (n.includes('openai')) return 'openai';
  // 无 npm 但 api 像 openai
  if (api && /\/v1\/?$/.test(api)) return 'openai';
  return null;
}

/** Anthropic SDK baseURL 不应带 /v1（SDK 会拼路径） */
export function normalizeAnthropicBaseUrl(api?: string): string | undefined {
  if (!api) return undefined;
  return api.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
}

/** OpenAI SDK baseURL 通常以 /v1 结尾 */
export function normalizeOpenAIBaseUrl(api?: string): string | undefined {
  if (!api) return undefined;
  const trimmed = api.replace(/\/+$/, '');
  if (/\/v1$/.test(trimmed)) return trimmed;
  // models.dev openai-compatible 的 api 已含 /v1；官方 openai 无 api 字段
  return trimmed;
}

function parseCatalog(raw: Record<string, unknown>): ModelsDevProvider[] {
  const out: ModelsDevProvider[] = [];
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const npm = typeof v['npm'] === 'string' ? v['npm'] : undefined;
    const api = typeof v['api'] === 'string' ? v['api'] : undefined;
    const protocol = resolveProtocol(npm, api);
    const modelsRaw = (v['models'] as Record<string, unknown>) ?? {};
    const models: ModelsDevModel[] = [];
    for (const [mid, mv] of Object.entries(modelsRaw)) {
      const m = (mv ?? {}) as Record<string, unknown>;
      models.push({
        id: typeof m['id'] === 'string' ? m['id'] : mid,
        name: typeof m['name'] === 'string' ? m['name'] : mid,
        tool_call: Boolean(m['tool_call']),
      });
    }
    out.push({
      id: typeof v['id'] === 'string' ? v['id'] : id,
      name: typeof v['name'] === 'string' ? v['name'] : id,
      npm,
      api,
      env: Array.isArray(v['env']) ? (v['env'] as string[]) : undefined,
      doc: typeof v['doc'] === 'string' ? v['doc'] : undefined,
      models,
      protocol,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchModelsDevCatalog(options?: {
  force?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ModelsDevCacheFile> {
  const path = cachePath();
  if (!options?.force && existsSync(path)) {
    try {
      const cached = JSON.parse(readFileSync(path, 'utf-8')) as ModelsDevCacheFile;
      if (Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.providers?.length) {
        return cached;
      }
    } catch {
      /* refresh */
    }
  }

  const fetchFn = options?.fetchImpl ?? fetch;
  const res = await fetchFn(MODELS_DEV_API);
  if (!res.ok) {
    throw new Error(`models.dev fetch failed: HTTP ${res.status}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  const file: ModelsDevCacheFile = {
    fetchedAt: Date.now(),
    source: MODELS_DEV_API,
    providers: parseCatalog(raw),
  };
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(file), 'utf-8');
  return file;
}

export function listModelsDevProviders(
  catalog: ModelsDevCacheFile,
  filter?: { protocol?: ModelsDevApiProtocol; q?: string }
): ModelsDevProvider[] {
  let list = catalog.providers.filter((p) => p.protocol !== null);
  if (filter?.protocol) {
    list = list.filter((p) => p.protocol === filter.protocol);
  }
  if (filter?.q?.trim()) {
    const q = filter.q.trim().toLowerCase();
    list = list.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.models.some((m) => m.id.toLowerCase().includes(q))
    );
  }
  return list;
}

export function getModelsDevProvider(
  catalog: ModelsDevCacheFile,
  id: string
): ModelsDevProvider | undefined {
  const key = id.trim().toLowerCase();
  return catalog.providers.find((p) => p.id.toLowerCase() === key);
}

/** 转为 PaCode Provider 草稿（apiKey 由调用方填写） */
export function modelsDevToProviderDraft(
  p: ModelsDevProvider,
  options?: { model?: string; apiKey?: string }
): {
  name: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  authStyle: ProviderAuthStyle;
  planMode: ProviderPlanMode;
  apiProtocol: ModelsDevApiProtocol;
  source: 'pacode';
} {
  if (!p.protocol) {
    throw new Error(`Provider ${p.id} has unsupported protocol`);
  }
  const model =
    options?.model ||
    p.models.find((m) => m.tool_call)?.id ||
    p.models[0]?.id;

  const baseUrl =
    p.protocol === 'anthropic'
      ? normalizeAnthropicBaseUrl(p.api)
      : p.api
        ? normalizeOpenAIBaseUrl(p.api)
        : p.id === 'openai'
          ? 'https://api.openai.com/v1'
          : undefined;

  return {
    name: p.id,
    apiKey: options?.apiKey ?? '',
    baseUrl,
    model,
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: p.protocol,
    source: 'pacode',
  };
}

export function formatModelsDevTable(
  providers: ModelsDevProvider[],
  limit = 40
): string {
  const slice = providers.slice(0, limit);
  const rows = slice.map((p) => {
    const m0 = p.models[0]?.id ?? '-';
    const n = p.models.length;
    return `  ${p.id.padEnd(22)} ${(p.protocol ?? '?').padEnd(10)} models=${String(n).padStart(3)}  e.g. ${m0}\n                       ${p.name}`;
  });
  const more =
    providers.length > limit ? `\n  … and ${providers.length - limit} more (use --q= to filter)` : '';
  return [
    `Models.dev providers usable by PaCode (${providers.length} with anthropic|openai protocol):`,
    ...rows,
    more,
  ].join('\n');
}
