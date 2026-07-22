/**
 * package version helper — 与 package.json 保持同步
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatPacodeVersion,
  getPackageVersion,
  resetPackageVersionCache,
} from '../src/pkg/version.js';

describe('getPackageVersion', () => {
  beforeEach(() => {
    resetPackageVersionCache();
  });

  it('matches root package.json version', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(getPackageVersion()).toBe(pkg.version);
    expect(formatPacodeVersion()).toBe(`PaCode v${pkg.version}`);
  });
});
