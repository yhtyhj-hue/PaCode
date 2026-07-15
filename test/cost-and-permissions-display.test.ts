/**
 * Cost estimate + permissions display
 */

import { describe, it, expect } from 'vitest';
import {
  resolveModelPricing,
  estimateTokenCostUsd,
  formatCostReport,
} from '../src/cli/cost-estimate.js';
import { formatPermissionsReport, describePermissionMode } from '../src/permission/format-display.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('resolveModelPricing', () => {
  it('uses Anthropic Sonnet list rates', () => {
    const p = resolveModelPricing('claude-sonnet-4-0');
    expect(p.inputPerMillion).toBe(3);
    expect(p.outputPerMillion).toBe(15);
    expect(p.isEstimate).toBe(false);
  });

  it('marks unknown models as estimate', () => {
    const p = resolveModelPricing('mystery-model-99');
    expect(p.isEstimate).toBe(true);
  });

  it('estimates cost from rates', () => {
    const p = resolveModelPricing('claude-sonnet-4-0');
    expect(estimateTokenCostUsd(1_000_000, 0, p)).toBe(3);
    expect(estimateTokenCostUsd(0, 1_000_000, p)).toBe(15);
  });

  it('formatCostReport includes rates and source', () => {
    const lines = formatCostReport('claude-sonnet-4-0', 1000, 500);
    expect(lines.some((l) => l.includes('Rates:'))).toBe(true);
    expect(lines.some((l) => l.includes('Source:'))).toBe(true);
    expect(lines.some((l) => l.includes('Est. cost:'))).toBe(true);
  });
});

describe('formatPermissionsReport', () => {
  it('lists deny/ask/allow rules', () => {
    const lines = formatPermissionsReport(PermissionMode.DEFAULT, {
      deny: ['Bash(rm *)'],
      ask: ['Bash'],
      allow: ['Read'],
    });
    expect(lines.join('\n')).toContain('Bash(rm *)');
    expect(lines.join('\n')).toContain('deny:');
    expect(lines.join('\n')).toContain('Current mode: default');
  });

  it('describes AUTO as deterministic not ML', () => {
    expect(describePermissionMode(PermissionMode.AUTO)).toMatch(/deterministic/i);
  });
});
