import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    await anim.show('claude-test-model');
    expect(console.log).toHaveBeenCalled();
  });
});
