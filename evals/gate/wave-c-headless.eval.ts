/**
 * Gate: Wave C headless / SDK surface
 */

import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../../src/cli/args.js';
import { CLI_OPTIONS } from '../../src/cli/args.js';

describe('eval:gate:wave-c-headless', () => {
  it('exposes print/-p CLI option', () => {
    expect(CLI_OPTIONS.print).toBeTruthy();
    expect(parseCliArgs(['-p', 'x']).values.print).toBe(true);
  });
});
