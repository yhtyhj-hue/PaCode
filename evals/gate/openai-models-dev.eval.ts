/**
 * Gate: OpenAI protocol presets + Models.dev draft mapping
 */

import { describe, it, expect } from 'vitest';
import { getProviderPreset, inferApiProtocolFromBaseUrl } from '../../src/pkg/ccswitch/presets.js';
import {
  modelsDevToProviderDraft,
  type ModelsDevProvider,
} from '../../src/pkg/models-dev/catalog.js';

describe('eval:gate:openai-models-dev', () => {
  it('includes openai and ollama presets', () => {
    expect(getProviderPreset('openai')?.apiProtocol).toBe('openai');
    expect(getProviderPreset('ollama')?.apiProtocol).toBe('openai');
    expect(inferApiProtocolFromBaseUrl('http://127.0.0.1:11434/v1')).toBe('openai');
  });

  it('models.dev draft keeps openai protocol', () => {
    const p: ModelsDevProvider = {
      id: 'openrouter',
      name: 'OpenRouter',
      npm: '@ai-sdk/openai-compatible',
      api: 'https://openrouter.ai/api/v1',
      models: [{ id: 'anthropic/claude-sonnet-4', tool_call: true }],
      protocol: 'openai',
    };
    const draft = modelsDevToProviderDraft(p, { apiKey: 'sk' });
    expect(draft.apiProtocol).toBe('openai');
    expect(draft.baseUrl).toContain('openrouter');
  });
});
