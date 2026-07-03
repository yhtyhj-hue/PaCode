/**
 * Permission System Tests
 */

import { describe, it, expect } from 'vitest';
import { PermissionSystem } from '../src/permission/system.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('PermissionSystem', () => {
  const ps = new PermissionSystem();

  it('PLAN mode blocks all execution', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Bash', input: { command: 'ls' } },
      mode: PermissionMode.PLAN,
      context: {} as any,
    });
    expect(result.allowed).toBe(false);
  });

  it('BYPASS mode allows all', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Bash', input: { command: 'ls' } },
      mode: PermissionMode.BYPASS,
      context: {} as any,
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks destructive git push --force', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Bash', input: { command: 'git push --force origin main' } },
      mode: PermissionMode.DONT_ASK,
      context: {} as any,
    });
    expect(result.allowed).toBe(false);
  });

  it('allows safe bash commands', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Bash', input: { command: 'ls -la' } },
      mode: PermissionMode.DONT_ASK,
      context: {} as any,
    });
    expect(result.allowed).toBe(true);
  });
});
