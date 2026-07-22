/**
 * OpenAI message conversion + Models.dev catalog parsing
 */

import { describe, it, expect } from 'vitest';
import { toOpenAIChatMessages, toOpenAITools } from '../src/agent/openai-messages.js';
import {
  listModelsDevProviders,
  modelsDevToProviderDraft,
  normalizeOpenAIBaseUrl,
  normalizeAnthropicBaseUrl,
} from '../src/pkg/models-dev/catalog.js';
import { getProviderPreset, inferApiProtocolFromBaseUrl } from '../src/pkg/ccswitch/presets.js';
import type { ModelsDevCacheFile } from '../src/pkg/models-dev/catalog.js';

describe('openai message bridge', () => {
  it('maps tool_use / tool_result to OpenAI tool_calls', () => {
    const msgs = toOpenAIChatMessages('sys', [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a\nb' }],
      },
    ]);
    expect(msgs[0]).toMatchObject({ role: 'system', content: 'sys' });
    expect(msgs[1]).toMatchObject({ role: 'user', content: 'hi' });
    expect(msgs[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 't1', function: { name: 'Bash' } }],
    });
    expect(msgs[3]).toMatchObject({ role: 'tool', tool_call_id: 't1' });
  });

  it('maps tools to function schema', () => {
    const tools = toOpenAITools([
      {
        name: 'Read',
        description: 'read file',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]);
    expect(tools[0]?.type).toBe('function');
    expect(tools[0]?.function.name).toBe('Read');
  });
});

describe('models.dev helpers', () => {
  it('normalizes base URLs', () => {
    expect(normalizeAnthropicBaseUrl('https://api.minimaxi.com/anthropic/v1')).toBe(
      'https://api.minimaxi.com/anthropic'
    );
    expect(normalizeOpenAIBaseUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1'
    );
  });

  it('infers openai protocol for ollama', () => {
    expect(inferApiProtocolFromBaseUrl('http://127.0.0.1:11434/v1')).toBe('openai');
    expect(inferApiProtocolFromBaseUrl('https://api.deepseek.com/anthropic')).toBe('anthropic');
  });

  it('ships openai/ollama presets', () => {
    expect(getProviderPreset('openai')?.apiProtocol).toBe('openai');
    expect(getProviderPreset('ollama')?.baseUrl).toContain('11434');
    expect(getProviderPreset('lmstudio')?.apiProtocol).toBe('openai');
  });

  it('filters catalog and drafts provider', () => {
    const catalog: ModelsDevCacheFile = {
      fetchedAt: Date.now(),
      source: 'test',
      providers: [
        {
          id: 'groq',
          name: 'Groq',
          npm: '@ai-sdk/openai-compatible',
          api: 'https://api.groq.com/openai/v1',
          models: [{ id: 'llama-3.3', tool_call: true }],
          protocol: 'openai',
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          npm: '@ai-sdk/anthropic',
          models: [{ id: 'claude-sonnet' }],
          protocol: 'anthropic',
        },
        {
          id: 'weird',
          name: 'Weird',
          npm: '@ai-sdk/google',
          models: [],
          protocol: null,
        },
      ],
    };
    const openaiOnly = listModelsDevProviders(catalog, { protocol: 'openai' });
    expect(openaiOnly.map((p) => p.id)).toEqual(['groq']);
    const draft = modelsDevToProviderDraft(catalog.providers[0]!, { apiKey: 'k' });
    expect(draft.apiProtocol).toBe('openai');
    expect(draft.baseUrl).toContain('groq.com');
    expect(draft.model).toBe('llama-3.3');
  });
});
