/**
 * Gate: CLI 版本号来自 package.json，禁止写死旧号
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatPacodeVersion, getPackageVersion } from '../../src/pkg/version.js';

describe('gate: package version sync', () => {
  it('formatPacodeVersion matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(getPackageVersion()).toBe(pkg.version);
    expect(formatPacodeVersion()).toBe(`PaCode v${pkg.version}`);
    expect(formatPacodeVersion()).not.toBe('PaCode v0.1.0');
  });
});
