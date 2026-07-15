/**
 * Shift+Tab permission mode cycling
 */

import { describe, it, expect } from 'vitest';
import { PermissionMode } from '../src/pkg/types.js';
import { cyclePermissionMode, SHIFT_TAB_MODES } from '../src/permission/cycle-mode.js';

describe('cyclePermissionMode', () => {
  it('cycles default → acceptEdits → plan → default', () => {
    expect(cyclePermissionMode(PermissionMode.DEFAULT)).toBe(PermissionMode.ACCEPT_EDITS);
    expect(cyclePermissionMode(PermissionMode.ACCEPT_EDITS)).toBe(PermissionMode.PLAN);
    expect(cyclePermissionMode(PermissionMode.PLAN)).toBe(PermissionMode.DEFAULT);
  });

  it('returns DEFAULT when leaving loose modes via Shift+Tab', () => {
    expect(cyclePermissionMode(PermissionMode.AUTO)).toBe(PermissionMode.DEFAULT);
    expect(cyclePermissionMode(PermissionMode.BYPASS)).toBe(PermissionMode.DEFAULT);
  });

  it('exposes three safe cycle targets', () => {
    expect(SHIFT_TAB_MODES).toHaveLength(3);
  });
});
