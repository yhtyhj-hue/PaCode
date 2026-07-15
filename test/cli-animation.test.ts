import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatBox, visibleWidth, getUiWidth, padEndVisible } from '../src/cli/repl-ui.js';

vi.mock('figlet', () => ({
  default: {
    text: (_text: string, cb: (err: Error | null, result?: string) => void) => {
      cb(null, 'PACODE');
    },
  },
}));

describe('BootAnimation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs show sequence without throwing', async () => {
    const { BootAnimation } = await import('../src/cli/animation.js');
    const anim = new BootAnimation();
    await anim.show({
      model: 'claude-test-model',
      apiKeyConfigured: true,
      providerCount: 1,
      activeProvider: 'test',
    });
    expect(console.log).toHaveBeenCalled();
  });

  it('draws aligned boxes that span terminal width', async () => {
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true });

    const { BootAnimation } = await import('../src/cli/animation.js');
    const anim = new BootAnimation();
    await anim.show({ model: 'm', apiKeyConfigured: true, providerCount: 1 });

    const boxBlocks = logs.filter((l) => l.includes('+') && l.includes('|'));
    expect(boxBlocks.length).toBeGreaterThanOrEqual(1);

    for (const block of boxBlocks) {
      const lines = block.split('\n').filter((l) => l.includes('+') || l.includes('|'));
      const widths = lines.map((l) => visibleWidth(l));
      expect(new Set(widths).size).toBe(1);
      expect(widths[0]).toBe(100);
    }
  });

  it('buildBootChecks reports FAIL when credentials missing', async () => {
    const { buildBootChecks } = await import('../src/cli/animation.js');
    const checks = buildBootChecks({ model: 'x', apiKeyConfigured: false, providerCount: 0 });
    expect(checks.find((c) => c.label === 'API credentials')?.ok).toBe(false);
    expect(checks.find((c) => c.label === 'Provider registry')?.ok).toBe(false);
    expect(checks.find((c) => c.label === 'Model')?.ok).toBe(true);
  });
});

describe('formatBox', () => {
  it('aligns all rows to the same visible width', () => {
    const box = formatBox(['short', 'a much longer line here'], { width: 40 });
    const lines = box.split('\n');
    const widths = lines.map((l) => visibleWidth(l));
    expect(widths.every((w) => w === 40)).toBe(true);
    expect(lines[0]).toMatch(/^\+-+\+$/);
    expect(lines[1]?.startsWith('|')).toBe(true);
    expect(lines[1]?.endsWith('|')).toBe(true);
  });

  it('padEndVisible matches target visible width', () => {
    expect(visibleWidth(padEndVisible('中文', 10))).toBe(10);
    expect(visibleWidth(padEndVisible('ab', 10))).toBe(10);
  });

  it('getUiWidth follows terminal columns', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 90, configurable: true });
    expect(getUiWidth()).toBe(90);
  });
});
