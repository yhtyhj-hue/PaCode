/**
 * Gate: 缺 API Key 启动引导必须分路径、可照做
 */

import { describe, it, expect } from 'vitest';
import { formatSetupGuide } from '../../src/cli/setup-guide.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('eval:gate:setup-guide', () => {
  it('lists Path A (MiniMax env) before Path B (cc-switch)', () => {
    const guide = formatSetupGuide();
    const iA = guide.indexOf('路径 A');
    const iB = guide.indexOf('路径 B');
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iB).toBeGreaterThan(iA);
    expect(guide).toMatch(/ANTHROPIC_API_KEY/);
    expect(guide).toMatch(/PACODE_API_KEY/);
    expect(guide).toMatch(/platform\.minimaxi\.com/);
    expect(guide).toMatch(/cc-switch presets/);
    expect(guide).toMatch(/cc-switch add/);
    expect(guide).toMatch(/cc-switch use/);
  });

  it('boot animation branches on apiKeyConfigured (no false Ready)', () => {
    const src = readFileSync(join(process.cwd(), 'src/cli/animation.ts'), 'utf8');
    expect(src).toMatch(/printSetupRequired/);
    expect(src).toMatch(/apiKeyConfigured/);
    expect(src).toMatch(/Not ready/);
  });
});
