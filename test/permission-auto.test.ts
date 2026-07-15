/**
 * Permission AUTO mode + rule engine tests
 */

import { describe, it, expect } from 'vitest';
import { PermissionSystem } from '../src/permission/system.js';
import { PermissionMode } from '../src/pkg/types.js';
import { matchPermissionRules } from '../src/permission/rules.js';
import { classifyToolCall } from '../src/permission/classifier.js';

describe('PermissionRules', () => {
  it('deny rule blocks before allow', () => {
    const result = matchPermissionRules(
      { id: '1', name: 'Bash', input: { command: 'rm -rf /tmp/x' } },
      { deny: ['Bash(rm *)'], allow: ['Bash(*)'] }
    );
    expect(result?.allowed).toBe(false);
  });

  it('allow rule auto-approves', () => {
    const result = matchPermissionRules(
      { id: '1', name: 'Read', input: { path: '/tmp/x' } },
      { allow: ['Read'] }
    );
    expect(result?.allowed).toBe(true);
    expect(result?.requiresInteraction).toBeFalsy();
  });

  it('ask rule requires confirmation', () => {
    const result = matchPermissionRules(
      { id: '1', name: 'Edit', input: { path: 'a.ts' } },
      { ask: ['Edit'] }
    );
    expect(result?.requiresInteraction).toBe(true);
  });
});

describe('classifyToolCall', () => {
  it('classifies readonly bash as safe', () => {
    const r = classifyToolCall({ id: '1', name: 'Bash', input: { command: 'ls -la' } });
    expect(r.risk).toBe('safe');
  });

  it('classifies destructive bash', () => {
    const r = classifyToolCall({
      id: '1',
      name: 'Bash',
      input: { command: 'git push --force origin main' },
    });
    expect(r.risk).toBe('destructive');
  });

  it('classifies Read as safe', () => {
    const r = classifyToolCall({ id: '1', name: 'Read', input: { path: 'x' } });
    expect(r.risk).toBe('safe');
  });

  it('classifies Grep as safe (execFile rg, no shell)', () => {
    const r = classifyToolCall({ id: '1', name: 'Grep', input: { pattern: '$(id)', path: '.' } });
    expect(r.risk).toBe('safe');
  });

  it('classifies Glob as safe', () => {
    const r = classifyToolCall({ id: '1', name: 'Glob', input: { pattern: '*.ts' } });
    expect(r.risk).toBe('safe');
  });

  it('classifies TodoWrite as safe', () => {
    const r = classifyToolCall({ id: '1', name: 'TodoWrite', input: { todos: [] } });
    expect(r.risk).toBe('safe');
  });
});

describe('PermissionSystem AUTO mode', () => {
  const ps = new PermissionSystem();

  it('auto-approves readonly bash without interaction', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Bash', input: { command: 'git status' } },
      mode: PermissionMode.AUTO,
      context: {} as any,
    });
    expect(result.allowed).toBe(true);
    expect(result.requiresInteraction).toBeFalsy();
  });

  it('auto-approves Read without interaction', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Read', input: { path: 'x.ts' } },
      mode: PermissionMode.AUTO,
      context: {} as any,
    });
    expect(result.allowed).toBe(true);
    expect(result.requiresInteraction).toBeFalsy();
  });

  it('blocks destructive bash in AUTO mode', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Bash', input: { command: 'rm -rf /' } },
      mode: PermissionMode.AUTO,
      context: {} as any,
    });
    expect(result.allowed).toBe(false);
  });

  it('requires confirmation for Edit in AUTO mode', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Edit', input: { path: 'x.ts' } },
      mode: PermissionMode.AUTO,
      context: {} as any,
    });
    expect(result.allowed).toBe(true);
    expect(result.requiresInteraction).toBe(true);
  });

  it('DEFAULT still requires interaction for Read', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Read', input: { path: 'x.ts' } },
      mode: PermissionMode.DEFAULT,
      context: {} as any,
    });
    expect(result.requiresInteraction).toBe(true);
  });
});
