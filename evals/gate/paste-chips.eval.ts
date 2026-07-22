/**
 * Gate: CC-style paste chips
 */

import { describe, it, expect } from 'vitest';
import {
  formatPastedTextRef,
  formatImageRef,
  getPastedTextRefNumLines,
  shouldCollapsePaste,
} from '../../src/cli/paste-chips.js';

describe('eval:gate:paste-chips', () => {
  it('matches CC placeholder formats', () => {
    expect(formatPastedTextRef(2, 5)).toBe('[Pasted text #2 +5 lines]');
    expect(formatImageRef(3)).toBe('[Image #3]');
    expect(getPastedTextRefNumLines('a\nb\nc\nd\ne\nf')).toBe(5);
    expect(shouldCollapsePaste('a\nb')).toBe(true);
  });
});
