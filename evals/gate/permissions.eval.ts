/**
 * Gate eval: tool permissionMode 门禁
 */
import { describe, it, expect } from 'vitest';
import {
  checkToolPermissionGate,
  satisfiesToolPermission,
  getModeRank,
} from '../../src/permission/tool-gate.js';
import { PermissionMode } from '../../src/pkg/types.js';

describe('eval:gate:permissions', () => {
  it('plan mode blocks tools requiring acceptEdits', () => {
    const result = checkToolPermissionGate(
      PermissionMode.PLAN,
      PermissionMode.ACCEPT_EDITS
    );
    expect(result).not.toBeNull();
    expect(result?.allowed).toBe(false);
  });

  it('acceptEdits satisfies default tool requirement', () => {
    expect(
      satisfiesToolPermission(PermissionMode.ACCEPT_EDITS, PermissionMode.DEFAULT)
    ).toBe(true);
  });

  it('mode rank ordering is monotonic', () => {
    expect(getModeRank(PermissionMode.PLAN)).toBeLessThan(
      getModeRank(PermissionMode.DEFAULT)
    );
    expect(getModeRank(PermissionMode.DEFAULT)).toBeLessThan(
      getModeRank(PermissionMode.ACCEPT_EDITS)
    );
    expect(getModeRank(PermissionMode.BYPASS)).toBeGreaterThanOrEqual(
      getModeRank(PermissionMode.DONT_ASK)
    );
  });
});
