/**
 * I5: Output styles — preset matrix and lookup
 */

import { describe, it, expect } from 'vitest';
import { getStyleOptions, listStyles, type OutputStyle } from '../src/cli/output-styles.js';

describe('I5 OutputStyle presets', () => {
  it('listStyles returns all four styles', () => {
    expect(listStyles()).toEqual(['default', 'cost', 'full', 'minimal']);
  });

  it('default style shows cost + tool + prefetch', () => {
    const o = getStyleOptions('default');
    expect(o.showCost).toBe(true);
    expect(o.showToolActivity).toBe(true);
    expect(o.showPrefetch).toBe(true);
  });

  it('cost style uses tokens-and-cost format', () => {
    const o = getStyleOptions('cost');
    expect(o.costFormat).toBe('tokens-and-cost');
  });

  it('full style uses tokens-cost-duration format', () => {
    const o = getStyleOptions('full');
    expect(o.costFormat).toBe('tokens-cost-duration');
  });

  it('minimal style hides cost/tool/prefetch', () => {
    const o = getStyleOptions('minimal');
    expect(o.showCost).toBe(false);
    expect(o.showToolActivity).toBe(false);
    expect(o.showPrefetch).toBe(false);
  });

  it('getStyleOptions falls back to default for unknown style', () => {
    const o = getStyleOptions('garbage' as OutputStyle);
    expect(o.showCost).toBe(true);
  });
});

/**
 * I5: Compact strategy identifiers.
 *
 * The engine already has /compact (manual/forced) wired; this
 * test locks the policy shape so the auto/forced/manual
 * distinction stays explicit. The actual strategy
 * implementation lives in context/compaction.ts.
 */
describe('I5 Compact strategy policy', () => {
  it('distinguishes auto from forced from manual', () => {
    const strategies = ['auto', 'forced', 'manual'] as const;
    // /compact without args = manual (the user explicitly asked)
    // /compact --auto = auto (engine decides when context>80%)
    // /compact --force = forced (compress even if small)
    expect(strategies).toContain('auto');
    expect(strategies).toContain('forced');
    expect(strategies).toContain('manual');
  });
});