/**
 * 内置 Anthropic Messages 兼容提供商预设（不引入 OpenAI SDK）
 *
 * planMode:
 * - api         按量计费 / 开放平台 API Key
 * - token-plan  腾讯 TokenHub Token Plan 等套餐网关
 * - coding-plan 各家 Coding Plan（Z.ai / MiniMax Coding / 豆包 Coding 等）
 */

import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '../defaults.js';

export type ProviderAuthStyle = 'api-key' | 'bearer';

/** 计费 / 套餐形态 */
export type ProviderPlanMode = 'api' | 'token-plan' | 'coding-plan';

/** 传输协议：Anthropic Messages 或 OpenAI Chat Completions */
export type ProviderApiProtocol = 'anthropic' | 'openai';

export interface ProviderPreset {
  /** 预设 id（也用作默认 provider 名） */
  id: string;
  /** 展示名 */
  label: string;
  /** Anthropic Messages 或 OpenAI-compatible base URL */
  baseUrl: string;
  /** 建议模型 id */
  model: string;
  /** api-key → x-api-key / Authorization；bearer → Authorization */
  authStyle: ProviderAuthStyle;
  /** 默认 api；Token Plan / Coding Plan 单独标注 */
  planMode: ProviderPlanMode;
  /** 默认 anthropic；openai = Chat Completions（Ollama / 官方 OpenAI / Models.dev） */
  apiProtocol: ProviderApiProtocol;
  /** 控制台 / 文档 */
  docsUrl?: string;
  notes?: string;
}

/** 国产 + 常见 Anthropic 兼容网关（含套餐） */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = Object.freeze([
  {
    id: 'minimax',
    label: 'MiniMax（国内 API）',
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: 'anthropic',
    docsUrl: 'https://platform.minimaxi.com/',
    notes: '默认产品预设',
  },
  {
    id: 'minimax-coding',
    label: 'MiniMax Coding Plan',
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    authStyle: 'bearer',
    planMode: 'coding-plan',
    apiProtocol: 'anthropic',
    docsUrl: 'https://platform.minimaxi.com/',
    notes: 'Coding Plan 密钥常见 sk-cp- 前缀；Claude Code 常用 AUTH_TOKEN',
  },
  {
    id: 'minimax-intl',
    label: 'MiniMax（国际）',
    baseUrl: 'https://api.minimax.io/anthropic',
    model: DEFAULT_MODEL,
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: 'anthropic',
    docsUrl: 'https://platform.minimax.io/',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-pro',
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: 'anthropic',
    docsUrl: 'https://api-docs.deepseek.com/guides/anthropic_api',
    notes: '也可用 deepseek-v4-flash',
  },
  {
    id: 'doubao',
    label: '豆包 / 火山方舟 Coding',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    model: 'ark-code-latest',
    authStyle: 'bearer',
    planMode: 'coding-plan',
    apiProtocol: 'anthropic',
    docsUrl: 'https://console.volcengine.com/ark',
    notes: 'Bearer；也可 doubao-seed-code 等已开通模型',
  },
  {
    id: 'glm',
    label: '智谱 GLM（国内 API）',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    model: 'glm-5.2',
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: 'anthropic',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/develop/claude/introduction',
    notes: '也可用 glm-4.7；别名 zhipu',
  },
  {
    id: 'glm-coding-plan',
    label: '智谱 / Z.ai Coding Plan',
    baseUrl: 'https://api.z.ai/api/anthropic',
    model: 'glm-5.2',
    authStyle: 'bearer',
    planMode: 'coding-plan',
    apiProtocol: 'anthropic',
    docsUrl: 'https://docs.z.ai/devpack/quick-start',
    notes: 'GLM Coding Plan 专属 Key；别名 glm-intl / zai',
  },
  {
    id: 'hunyuan',
    label: '腾讯混元（API）',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/anthropic',
    model: 'hunyuan-2.0-thinking-20251109',
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: 'anthropic',
    docsUrl: 'https://cloud.tencent.com/document/product/1729/127293',
    notes: '按量 API；套餐请用 tencent-token-plan',
  },
  {
    id: 'tencent-token-plan',
    label: '腾讯 Token Plan（TokenHub）',
    baseUrl: 'https://api.lkeap.cloud.tencent.com/plan/anthropic',
    model: 'tc-code-latest',
    authStyle: 'bearer',
    planMode: 'token-plan',
    apiProtocol: 'anthropic',
    docsUrl: 'https://cloud.tencent.com/document/product/1823/130070',
    notes:
      '套餐 Key；可换 glm-5 / kimi-k2.5 / minimax-m2.7 / deepseek-v4-* / hy3 等套餐内模型',
  },
  {
    id: 'qwen',
    label: '阿里通义千问（国内）',
    baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
    model: 'qwen3-coder-plus',
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: 'anthropic',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/anthropic-api-messages',
    notes: '别名 dashscope / aliyun',
  },
  {
    id: 'qwen-intl',
    label: '阿里通义千问（国际）',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
    model: 'qwen3-coder-plus',
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: 'anthropic',
    docsUrl: 'https://www.alibabacloud.com/help/model-studio/anthropic-api-messages',
  },
  {
    id: 'kimi',
    label: 'Kimi / Moonshot（API）',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    model: 'kimi-k2.5',
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: 'anthropic',
    docsUrl: 'https://platform.moonshot.cn/',
  },
  {
    id: 'kimi-coding',
    label: 'Kimi Code 订阅',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    model: 'kimi-k2.5',
    authStyle: 'bearer',
    planMode: 'coding-plan',
    apiProtocol: 'anthropic',
    docsUrl: 'https://www.kimi.com/code/',
    notes: 'Kimi Code 订阅 Key；端点与开放平台相同，用套餐密钥',
  },
  {
    id: 'anthropic',
    label: 'Anthropic 官方',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: 'anthropic',
    docsUrl: 'https://console.anthropic.com/',
  },
  {
    id: 'openai',
    label: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1',
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: 'openai',
    docsUrl: 'https://platform.openai.com/',
    notes: 'Chat Completions；也可用 gpt-4o / o3 等。更多厂商见 pacode cc-switch models-dev',
  },
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5-coder',
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: 'openai',
    docsUrl: 'https://ollama.com/',
    notes: '无需真实 key（可用 ollama）；先 ollama pull <model>',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio（本地）',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
    authStyle: 'api-key',
    planMode: 'api',
    apiProtocol: 'openai',
    docsUrl: 'https://lmstudio.ai/',
    notes: '在 LM Studio 启动本地服务器后使用',
  },
]);

/** id 别名 → 正式 preset id */
const PRESET_ALIASES: Record<string, string> = {
  zhipu: 'glm',
  'zhipu-ai': 'glm',
  bigmodel: 'glm',
  zai: 'glm-coding-plan',
  'glm-intl': 'glm-coding-plan',
  tencent: 'hunyuan',
  'hunyuan-tencent': 'hunyuan',
  tokenhub: 'tencent-token-plan',
  'token-plan': 'tencent-token-plan',
  'tencent-plan': 'tencent-token-plan',
  lkeap: 'tencent-token-plan',
  'lkeap-plan': 'tencent-token-plan',
  dashscope: 'qwen',
  aliyun: 'qwen',
  alibaba: 'qwen',
  tongyi: 'qwen',
  'minimax-cp': 'minimax-coding',
  'minimax-plan': 'minimax-coding',
  'openai-official': 'openai',
  gpt: 'openai',
  local: 'ollama',
};

export function listProviderPresets(filter?: {
  planMode?: ProviderPlanMode;
}): ProviderPreset[] {
  const all = [...PROVIDER_PRESETS];
  if (!filter?.planMode) return all;
  return all.filter((p) => p.planMode === filter.planMode);
}

export function getProviderPreset(id: string): ProviderPreset | undefined {
  const key = id.trim().toLowerCase();
  const resolved = PRESET_ALIASES[key] ?? key;
  return PROVIDER_PRESETS.find((p) => p.id === resolved);
}

export function normalizePlanMode(raw: unknown): ProviderPlanMode | undefined {
  if (raw === 'api' || raw === 'payg' || raw === 'pay-as-you-go') return 'api';
  if (
    raw === 'token-plan' ||
    raw === 'token_plan' ||
    raw === 'tokenplan' ||
    raw === 'tokenhub'
  ) {
    return 'token-plan';
  }
  if (
    raw === 'coding-plan' ||
    raw === 'coding_plan' ||
    raw === 'codingplan' ||
    raw === 'coding'
  ) {
    return 'coding-plan';
  }
  return undefined;
}

/** 根据 base URL 推断套餐形态 */
export function inferPlanModeFromBaseUrl(baseUrl?: string): ProviderPlanMode {
  if (!baseUrl) return 'api';
  const u = baseUrl.toLowerCase();
  if (u.includes('/plan/') || u.includes('lkeap.cloud.tencent.com/plan')) {
    return 'token-plan';
  }
  if (
    u.includes('/api/coding') ||
    u.includes('api.z.ai') ||
    u.includes('ark.cn-beijing.volces.com/api/coding')
  ) {
    return 'coding-plan';
  }
  return 'api';
}

export function normalizeApiProtocol(raw: unknown): ProviderApiProtocol | undefined {
  if (raw === 'openai' || raw === 'openai-compatible' || raw === 'chat') return 'openai';
  if (raw === 'anthropic' || raw === 'messages') return 'anthropic';
  return undefined;
}

/** 根据 base URL 粗推断协议（可被 preset / 显式字段覆盖） */
export function inferApiProtocolFromBaseUrl(baseUrl?: string): ProviderApiProtocol {
  if (!baseUrl) return 'anthropic';
  const u = baseUrl.toLowerCase();
  if (
    u.includes('openai.com') ||
    u.includes('ollama') ||
    u.includes(':11434') ||
    u.includes(':1234') ||
    u.includes('lmstudio')
  ) {
    return 'openai';
  }
  // 典型 OpenAI-compatible：以 /v1 结尾且路径不含 anthropic
  if (/\/v1\/?$/.test(u) && !u.includes('anthropic')) {
    return 'openai';
  }
  return 'anthropic';
}

/** 打印给 CLI / 帮助用；可按 planMode 过滤 */
export function formatPresetTable(filter?: { planMode?: ProviderPlanMode }): string {
  const list = listProviderPresets(filter);
  const header = filter?.planMode
    ? `Built-in presets (planMode=${filter.planMode}):`
    : 'Built-in presets (anthropic Messages + openai Chat Completions):';
  const rows = list.map(
    (p) =>
      `  ${p.id.padEnd(20)} ${p.label}\n` +
      `                       model=${p.model}  proto=${p.apiProtocol}  auth=${p.authStyle}  plan=${p.planMode}\n` +
      `                       ${p.baseUrl}`
  );
  return [header, ...rows].join('\n');
}
