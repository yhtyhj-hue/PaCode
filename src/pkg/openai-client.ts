/**
 * OpenAI / OpenAI-compatible 客户端（官方、Ollama、LM Studio、Models.dev openai-compatible）
 */

import OpenAI from 'openai';

export function createOpenAIClient(options: {
  apiKey?: string;
  baseUrl?: string;
}): OpenAI {
  // Ollama 本地常不校验 key，占位即可
  const key = options.apiKey?.trim() || 'ollama';
  return new OpenAI({
    apiKey: key,
    baseURL: options.baseUrl,
  });
}
