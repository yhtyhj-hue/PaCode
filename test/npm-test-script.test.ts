/**
 * npm test must not pull live periodic evals (hang / API flakiness)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('npm test script', () => {
  it('excludes evals/periodic from default npm test', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['test']).toContain("exclude 'evals/periodic/**'");
    expect(pkg.scripts['test:all']).toBe('vitest run');
    expect(pkg.scripts['eval:periodic']).toContain('evals/periodic');
  });
});
