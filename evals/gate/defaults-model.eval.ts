/**
 * Gate: DEFAULT_MODEL single source of truth (MiniMax)
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODEL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_BASE_URL,
} from '../../src/pkg/defaults.js';
import { PaudeConfigSchema } from '../../src/pkg/config/index.js';
import { preferScriptedPrefetchDag } from '../../src/services/agent-scheduler/llm-explore-orchestrator.js';
import { CCSwitchClient } from '../../src/pkg/ccswitch/index.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('eval:gate:defaults-model', () => {
  it('exports MiniMax defaults (not Claude Sonnet)', () => {
    expect(DEFAULT_MODEL).toBe('MiniMax-M3');
    expect(DEFAULT_MODEL).not.toMatch(/claude-sonnet/i);
    expect(DEFAULT_BASE_URL).toBe('https://api.minimaxi.com/anthropic');
    expect(DEFAULT_MAX_TOKENS).toBe(8192);
  });

  it('config schema defaults to DEFAULT_MODEL', () => {
    const cfg = PaudeConfigSchema.parse({});
    expect(cfg.model.model).toBe(DEFAULT_MODEL);
  });

  it('PACODE_PREFETCH_DAG only enables scripted path when =1', () => {
    expect(preferScriptedPrefetchDag({})).toBe(false);
    expect(preferScriptedPrefetchDag({ PACODE_PREFETCH_DAG: '0' } as NodeJS.ProcessEnv)).toBe(
      false
    );
    expect(preferScriptedPrefetchDag({ PACODE_PREFETCH_DAG: '1' } as NodeJS.ProcessEnv)).toBe(
      true
    );
  });

  it('never auto-imports Claude Code settings on construct', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacode-cc-'));
    const client = new CCSwitchClient(join(dir, 'providers.json'));
    expect(client.autoImportFromClaudeCode()).toBeNull();
    expect(client.list()).toEqual([]);
  });
});
