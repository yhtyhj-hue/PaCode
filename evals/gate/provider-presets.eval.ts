/**
 * Gate: multi-provider presets (DeepSeek / 豆包 / MiniMax default)
 */

import { describe, it, expect } from 'vitest';
import {
  getProviderPreset,
  listProviderPresets,
  formatPresetTable,
} from '../../src/pkg/ccswitch/presets.js';
import { DEFAULT_MODEL } from '../../src/pkg/defaults.js';

describe('eval:gate:provider-presets', () => {
  it('default preset stays MiniMax', () => {
    expect(getProviderPreset('minimax')?.model).toBe(DEFAULT_MODEL);
  });

  it('includes Chinese Anthropic-compatible providers', () => {
    const ids = listProviderPresets().map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'minimax',
        'deepseek',
        'doubao',
        'glm',
        'hunyuan',
        'qwen',
        'kimi',
      ])
    );
    expect(getProviderPreset('doubao')?.authStyle).toBe('bearer');
    expect(getProviderPreset('deepseek')?.baseUrl).toContain('/anthropic');
    expect(getProviderPreset('glm')?.baseUrl).toContain('bigmodel.cn');
    expect(getProviderPreset('zhipu')?.id).toBe('glm');
    expect(getProviderPreset('hunyuan')?.baseUrl).toContain('hunyuan');
    expect(getProviderPreset('qwen')?.baseUrl).toContain('dashscope');
    expect(getProviderPreset('tencent')?.id).toBe('hunyuan');
    expect(getProviderPreset('aliyun')?.id).toBe('qwen');
    expect(getProviderPreset('tencent-token-plan')?.planMode).toBe('token-plan');
    expect(getProviderPreset('tokenhub')?.id).toBe('tencent-token-plan');
  });

  it('preset table is printable for CLI', () => {
    expect(formatPresetTable().split('\n').length).toBeGreaterThan(5);
  });
});
