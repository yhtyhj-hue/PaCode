/**
 * 统一创建 Anthropic SDK 客户端 — 支持 x-api-key 与 Bearer
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ProviderAuthStyle } from './ccswitch/presets.js';

export type { ProviderAuthStyle };

export function createAnthropicClient(options: {
  apiKey?: string;
  baseUrl?: string;
  authStyle?: ProviderAuthStyle;
}): Anthropic {
  const baseURL = options.baseUrl;
  const key = options.apiKey;
  // 豆包方舟 Coding 等网关使用 Authorization: Bearer
  if (options.authStyle === 'bearer') {
    return new Anthropic({ authToken: key, baseURL });
  }
  return new Anthropic({ apiKey: key, baseURL });
}
