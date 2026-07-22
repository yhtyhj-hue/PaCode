/**
 * Provider presets — DeepSeek / 豆包等 Anthropic 兼容网关
 */

import { describe, it, expect } from 'vitest';
import {
  listProviderPresets,
  getProviderPreset,
  formatPresetTable,
  PROVIDER_PRESETS,
} from '../src/pkg/ccswitch/presets.js';
import { createAnthropicClient } from '../src/pkg/anthropic-client.js';
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '../src/pkg/defaults.js';
import { resolveAppConfig } from '../src/pkg/app-config.js';

describe('provider presets', () => {
  it('includes minimax as default product preset', () => {
    const m = getProviderPreset('minimax');
    expect(m?.model).toBe(DEFAULT_MODEL);
    expect(m?.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(m?.authStyle).toBe('api-key');
  });

  it('ships deepseek, doubao, glm, hunyuan, and qwen', () => {
    const ds = getProviderPreset('deepseek');
    expect(ds?.baseUrl).toBe('https://api.deepseek.com/anthropic');
    expect(ds?.authStyle).toBe('api-key');

    const db = getProviderPreset('doubao');
    expect(db?.baseUrl).toContain('volces.com');
    expect(db?.authStyle).toBe('bearer');

    const glm = getProviderPreset('glm');
    expect(glm?.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic');
    expect(glm?.model).toBe('glm-5.2');
    expect(glm?.authStyle).toBe('api-key');
    expect(getProviderPreset('zhipu')?.id).toBe('glm');
    expect(getProviderPreset('zai')?.id).toBe('glm-coding-plan');
    expect(getProviderPreset('glm-intl')?.id).toBe('glm-coding-plan');
    expect(getProviderPreset('glm-coding-plan')?.authStyle).toBe('bearer');

    const hy = getProviderPreset('hunyuan');
    expect(hy?.baseUrl).toBe('https://api.hunyuan.cloud.tencent.com/anthropic');
    expect(hy?.model).toMatch(/hunyuan/i);
    expect(getProviderPreset('tencent')?.id).toBe('hunyuan');

    const qw = getProviderPreset('qwen');
    expect(qw?.baseUrl).toBe('https://dashscope.aliyuncs.com/apps/anthropic');
    expect(qw?.model).toMatch(/qwen/i);
    expect(getProviderPreset('dashscope')?.id).toBe('qwen');
    expect(getProviderPreset('aliyun')?.id).toBe('qwen');
    expect(getProviderPreset('qwen-intl')?.baseUrl).toContain('dashscope-intl');
  });

  it('listProviderPresets returns frozen catalog copy', () => {
    const list = listProviderPresets();
    expect(list.length).toBe(PROVIDER_PRESETS.length);
    expect(list.map((p) => p.id)).toEqual(
      expect.arrayContaining(['kimi', 'glm', 'hunyuan', 'qwen', 'anthropic'])
    );
  });

  it('formatPresetTable mentions Chinese providers', () => {
    const t = formatPresetTable();
    expect(t).toMatch(/deepseek/);
    expect(t).toMatch(/doubao/);
    expect(t).toMatch(/glm/);
    expect(t).toMatch(/hunyuan/);
    expect(t).toMatch(/qwen/);
    expect(t).toMatch(/bearer/);
  });

  it('createAnthropicClient accepts bearer style', () => {
    const client = createAnthropicClient({
      apiKey: 'ark-test',
      baseUrl: 'https://example.com',
      authStyle: 'bearer',
    });
    expect(client).toBeTruthy();
  });

  it('resolveAppConfig passes through cli authStyle', () => {
    const prev = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    try {
      const cfg = resolveAppConfig({ authStyle: 'bearer', model: 'ark-code-latest' });
      expect(cfg.authStyle).toBe('bearer');
      expect(cfg.model).toBe('ark-code-latest');
    } finally {
      if (prev === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = prev;
    }
  });
});
