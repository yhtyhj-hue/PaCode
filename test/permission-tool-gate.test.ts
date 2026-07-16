/**
 * Tool permissionMode gate tests (E3)
 */

import { describe, it, expect } from 'vitest';
import {
  getModeRank,
  checkToolPermissionGate,
  satisfiesToolPermission,
} from '../src/permission/tool-gate.js';
import { PermissionSystem } from '../src/permission/system.js';
import { PermissionMode, ToolDefinition } from '../src/pkg/types.js';

describe('getModeRank', () => {
  it('orders modes from plan to bypass', () => {
    expect(getModeRank(PermissionMode.PLAN)).toBeLessThan(getModeRank(PermissionMode.DEFAULT));
    expect(getModeRank(PermissionMode.DEFAULT)).toBeLessThan(
      getModeRank(PermissionMode.ACCEPT_EDITS)
    );
    expect(getModeRank(PermissionMode.ACCEPT_EDITS)).toBeLessThan(getModeRank(PermissionMode.AUTO));
    expect(getModeRank(PermissionMode.DONT_ASK)).toBeLessThan(getModeRank(PermissionMode.BYPASS));
  });
});

describe('checkToolPermissionGate', () => {
  it('allows when session mode meets tool requirement', () => {
    expect(checkToolPermissionGate(PermissionMode.DEFAULT, PermissionMode.DEFAULT)).toBeNull();
    expect(
      checkToolPermissionGate(PermissionMode.ACCEPT_EDITS, PermissionMode.ACCEPT_EDITS)
    ).toBeNull();
    expect(checkToolPermissionGate(PermissionMode.AUTO, PermissionMode.DEFAULT)).toBeNull();
  });

  it('blocks when session mode is too weak', () => {
    const result = checkToolPermissionGate(PermissionMode.DEFAULT, PermissionMode.ACCEPT_EDITS);
    expect(result?.allowed).toBe(false);
    expect(result?.reason).toContain('acceptEdits');
  });

  it('bypass session skips gate', () => {
    expect(checkToolPermissionGate(PermissionMode.BYPASS, PermissionMode.ACCEPT_EDITS)).toBeNull();
  });
});

describe('PermissionSystem — tool permissionMode gate', () => {
  const editTool: ToolDefinition = {
    name: 'Edit',
    description: 'Edit file',
    inputSchema: {},
    concurrencySafe: false,
    permissionMode: PermissionMode.ACCEPT_EDITS,
    async execute() {
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    },
  };

  const readTool: ToolDefinition = {
    name: 'Read',
    description: 'Read file',
    inputSchema: {},
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute() {
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    },
  };

  const ps = new PermissionSystem({
    getToolDefinition: (name) => (name === 'Edit' ? editTool : name === 'Read' ? readTool : undefined),
  });

  it('blocks Edit in DEFAULT session when tool requires acceptEdits', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Edit', input: { path: 'a.ts' } },
      mode: PermissionMode.DEFAULT,
      context: {} as never,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('acceptEdits');
  });

  it('allows Edit in ACCEPT_EDITS session', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Edit', input: { path: 'a.ts' } },
      mode: PermissionMode.ACCEPT_EDITS,
      context: {} as never,
    });
    expect(result.allowed).toBe(true);
  });

  it('allows Read in DEFAULT session without confirm', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Read', input: { path: 'a.ts' } },
      mode: PermissionMode.DEFAULT,
      context: {} as never,
    });
    expect(result.allowed).toBe(true);
    expect(result.requiresInteraction).toBeFalsy();
  });

  it('plan mode still blocks before tool gate', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Read', input: { path: 'a.ts' } },
      mode: PermissionMode.PLAN,
      context: {} as never,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Plan mode');
  });

  it('satisfiesToolPermission helper matches gate', () => {
    expect(satisfiesToolPermission(PermissionMode.DEFAULT, PermissionMode.ACCEPT_EDITS)).toBe(false);
    expect(satisfiesToolPermission(PermissionMode.AUTO, PermissionMode.ACCEPT_EDITS)).toBe(true);
  });
});
