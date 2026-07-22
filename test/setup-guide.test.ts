import { describe, it, expect } from 'vitest';
import { formatSetupGuide } from '../src/cli/setup-guide.js';

describe('formatSetupGuide', () => {
  it('gives ordered MiniMax then multi-provider steps', () => {
    const text = formatSetupGuide();
    expect(text.indexOf('路径 A')).toBeLessThan(text.indexOf('路径 B'));
    expect(text).toContain('export ANTHROPIC_API_KEY');
    expect(text).toContain('pacode cc-switch presets');
    expect(text).toMatch(/MiniMax/);
  });
});
