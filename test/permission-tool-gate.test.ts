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
  // 产品语义：Edit 声明 DEFAULT，DEFAULT 会话确认后可改；ACCEPT_EDITS 免确认
  const editTool: ToolDefinition = {
    name: 'Edit',
    description: 'Edit file',
    inputSchema: {},
    concurrencySafe: false,
    permissionMode: PermissionMode.DEFAULT,
    async execute() {
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    },
  };

  const gatedTool: ToolDefinition = {
    name: 'GatedAdmin',
    description: 'Requires acceptEdits session',
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
    getToolDefinition: (name) => {
      if (name === 'Edit') return editTool;
      if (name === 'Read') return readTool;
      if (name === 'GatedAdmin') return gatedTool;
      return undefined;
    },
  });

  it('allows Edit in DEFAULT with confirm (not hard-denied by gate)', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Edit', input: { path: 'a.ts' } },
      mode: PermissionMode.DEFAULT,
      context: {} as never,
    });
    expect(result.allowed).toBe(true);
    expect(result.requiresInteraction).toBe(true);
  });

  it('still blocks tools that declare acceptEdits when session is DEFAULT', () => {
    const result = ps.check({
      tool: { id: '1', name: 'GatedAdmin', input: {} },
      mode: PermissionMode.DEFAULT,
      context: {} as never,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('acceptEdits');
  });

  it('allows Edit in ACCEPT_EDITS session without confirm', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Edit', input: { path: 'a.ts' } },
      mode: PermissionMode.ACCEPT_EDITS,
      context: {} as never,
    });
    expect(result.allowed).toBe(true);
    expect(result.requiresInteraction).toBeFalsy();
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

  it('plan mode blocks Edit before tool gate (Read is PLAN-whitelisted)', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Edit', input: { path: 'a.ts', oldText: 'a', newText: 'b' } },
      mode: PermissionMode.PLAN,
      context: {} as never,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Plan mode');
  });

  it('plan mode allows Read for research', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Read', input: { path: 'a.ts' } },
      mode: PermissionMode.PLAN,
      context: {} as never,
    });
    expect(result.allowed).toBe(true);
  });

  it('satisfiesToolPermission helper matches gate', () => {
    expect(satisfiesToolPermission(PermissionMode.DEFAULT, PermissionMode.ACCEPT_EDITS)).toBe(false);
    expect(satisfiesToolPermission(PermissionMode.AUTO, PermissionMode.ACCEPT_EDITS)).toBe(true);
  });
});
