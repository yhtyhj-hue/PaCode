/**
 * Gate: Token Plan presets + CC import parsing (no live home DB)
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getProviderPreset,
  listProviderPresets,
  inferPlanModeFromBaseUrl,
} from '../../src/pkg/ccswitch/presets.js';
import { parseClaudeSettingsProviders } from '../../src/pkg/ccswitch/import-sources.js';
import { CCSwitchClient } from '../../src/pkg/ccswitch/index.js';

describe('eval:gate:cc-import-token-plan', () => {
  it('token-plan preset points at Tencent LKEAP plan gateway', () => {
    const p = getProviderPreset('tencent-token-plan');
    expect(p?.baseUrl).toBe('https://api.lkeap.cloud.tencent.com/plan/anthropic');
    expect(p?.planMode).toBe('token-plan');
    expect(listProviderPresets({ planMode: 'token-plan' }).length).toBeGreaterThan(0);
  });

  it('infers plan mode from URL', () => {
    expect(inferPlanModeFromBaseUrl('https://api.lkeap.cloud.tencent.com/plan/anthropic')).toBe(
      'token-plan'
    );
  });

  it('imports Claude settings into PaCode providers without auto on construct', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacode-gate-imp-'));
    try {
      const settings = join(dir, 'settings.json');
      writeFileSync(
        settings,
        JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'https://api.lkeap.cloud.tencent.com/plan/anthropic',
            ANTHROPIC_AUTH_TOKEN: 'gate-tp-key',
            ANTHROPIC_MODEL: 'tc-code-latest',
          },
        })
      );
      const cc = new CCSwitchClient(join(dir, 'providers.json'));
      expect(cc.autoImportFromClaudeCode()).toBeNull();
      expect(cc.list()).toEqual([]);
      for (const p of parseClaudeSettingsProviders(settings)) {
        cc.addProvider({ ...p, name: 'token-plan' });
      }
      expect(cc.list()[0]?.planMode).toBe('token-plan');
      expect(cc.list()[0]?.authStyle).toBe('bearer');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
