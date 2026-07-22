/**
 * CC Switch / Claude settings import + Token Plan presets
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseClaudeSettingsProviders,
  parseCcSwitchConfigJson,
} from '../src/pkg/ccswitch/import-sources.js';
import {
  getProviderPreset,
  listProviderPresets,
  normalizePlanMode,
  formatPresetTable,
  inferPlanModeFromBaseUrl,
} from '../src/pkg/ccswitch/presets.js';
import { CCSwitchClient } from '../src/pkg/ccswitch/index.js';

describe('token-plan / coding-plan presets', () => {
  it('ships tencent-token-plan with bearer + /plan/ URL', () => {
    const p = getProviderPreset('tencent-token-plan');
    expect(p?.planMode).toBe('token-plan');
    expect(p?.authStyle).toBe('bearer');
    expect(p?.baseUrl).toContain('/plan/anthropic');
    expect(getProviderPreset('tokenhub')?.id).toBe('tencent-token-plan');
  });

  it('ships glm-coding-plan and minimax-coding', () => {
    expect(getProviderPreset('glm-coding-plan')?.planMode).toBe('coding-plan');
    expect(getProviderPreset('zai')?.id).toBe('glm-coding-plan');
    expect(getProviderPreset('glm-intl')?.id).toBe('glm-coding-plan');
    expect(getProviderPreset('minimax-coding')?.planMode).toBe('coding-plan');
  });

  it('filters presets by planMode', () => {
    const plans = listProviderPresets({ planMode: 'token-plan' });
    expect(plans.every((p) => p.planMode === 'token-plan')).toBe(true);
    expect(plans.some((p) => p.id === 'tencent-token-plan')).toBe(true);
    expect(formatPresetTable({ planMode: 'coding-plan' })).toMatch(/coding-plan/);
  });

  it('normalizePlanMode accepts aliases', () => {
    expect(normalizePlanMode('tokenplan')).toBe('token-plan');
    expect(normalizePlanMode('coding')).toBe('coding-plan');
    expect(normalizePlanMode('payg')).toBe('api');
  });

  it('inferPlanModeFromBaseUrl detects token plan gateway', () => {
    expect(
      inferPlanModeFromBaseUrl('https://api.lkeap.cloud.tencent.com/plan/anthropic')
    ).toBe('token-plan');
    expect(inferPlanModeFromBaseUrl('https://api.z.ai/api/anthropic')).toBe('coding-plan');
  });
});

describe('import sources', () => {
  it('parses Claude settings env block', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacode-claude-'));
    const path = join(dir, 'settings.json');
    writeFileSync(
      path,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://api.lkeap.cloud.tencent.com/plan/anthropic',
          ANTHROPIC_AUTH_TOKEN: 'tp-key',
          ANTHROPIC_MODEL: 'tc-code-latest',
        },
      })
    );
    try {
      const list = parseClaudeSettingsProviders(path);
      expect(list).toHaveLength(1);
      expect(list[0]?.planMode).toBe('token-plan');
      expect(list[0]?.authStyle).toBe('bearer');
      expect(list[0]?.model).toBe('tc-code-latest');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses legacy cc-switch config.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacode-ccs-'));
    const path = join(dir, 'config.json');
    writeFileSync(
      path,
      JSON.stringify({
        current: 'ds',
        providers: [
          {
            id: 'ds',
            name: 'ds',
            env: {
              ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
              ANTHROPIC_API_KEY: 'k',
              ANTHROPIC_MODEL: 'deepseek-v4-pro',
            },
          },
        ],
      })
    );
    try {
      const list = parseCcSwitchConfigJson(path);
      expect(list[0]?.name).toBe('ds');
      expect(list[0]?.active).toBe(true);
      expect(list[0]?.source).toBe('cc-switch');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('importFromExternal merges into providers.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacode-merge-'));
    const settings = join(dir, 'settings.json');
    writeFileSync(
      settings,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
          ANTHROPIC_API_KEY: 'glm-k',
          ANTHROPIC_MODEL: 'glm-5.2',
        },
      })
    );
    const cc = new CCSwitchClient(join(dir, 'providers.json'));
    const imported = parseClaudeSettingsProviders(settings);
    for (const p of imported) cc.addProvider({ ...p, name: 'from-claude' });
    expect(cc.list()[0]?.model).toBe('glm-5.2');
    rmSync(dir, { recursive: true, force: true });
  });
});
