/**
 * Permission AUTO mode + rule engine tests
 */

import { describe, it, expect, afterEach } from 'vitest';
import { PermissionSystem } from '../src/permission/system.js';
import { PermissionMode } from '../src/pkg/types.js';
import { matchPermissionRules } from '../src/permission/rules.js';
import {
  classifyToolCall,
  CLASSIFIER_CONTRACT,
  CLASSIFIER_REGISTRY_CONTRACT,
  getClassifierBackend,
  getClassifierRegistryContract,
  setClassifierBackend,
  resetClassifierBackend,
} from '../src/permission/classifier.js';

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

  it('DEFAULT auto-allows Read (Claude Code-like)', () => {
    const result = ps.check({
      tool: { id: '1', name: 'Read', input: { path: 'x.ts' } },
      mode: PermissionMode.DEFAULT,
      context: {} as any,
    });
    expect(result.allowed).toBe(true);
    expect(result.requiresInteraction).toBeFalsy();
  });
});

describe('G6/v0 classifier contract', () => {
  it('returns contract category confidence on classify', () => {
    const r = classifyToolCall({ id: '1', name: 'Read', input: { path: 'x' } });
    expect(r.contract).toBe(CLASSIFIER_CONTRACT);
    expect(r.category).toBe('readonly');
    expect(r.confidence).toBe('high');
  });

  it('classifies NotebookEdit and Coordinator as moderate', () => {
    const n = classifyToolCall({
      id: '1',
      name: 'NotebookEdit',
      input: { path: 'a.ipynb' },
    });
    expect(n.risk).toBe('moderate');
    expect(n.category).toBe('mutation');
    const c = classifyToolCall({
      id: '2',
      name: 'Coordinator',
      input: { action: 'poll', team_id: 't' },
    });
    expect(c.risk).toBe('moderate');
    expect(c.category).toBe('orchestration');
  });
});

describe('G6/v1 pluggable classifier', () => {
  afterEach(() => {
    resetClassifierBackend();
    delete process.env['PACODE_CLASSIFIER'];
  });

  it('exposes registry contract and default backend id', () => {
    expect(getClassifierRegistryContract()).toBe(CLASSIFIER_REGISTRY_CONTRACT);
    expect(getClassifierBackend().id).toBe('deterministic');
  });

  it('injected backend is used by classifyToolCall and PermissionSystem', () => {
    setClassifierBackend({
      id: 'test-mock',
      contract: 'g6/test',
      classify: () => ({
        risk: 'destructive',
        reason: 'mock deny',
        contract: 'g6/test',
        backend: 'test-mock',
        category: 'unknown',
        confidence: 'high',
      }),
    });
    const r = classifyToolCall({ id: '1', name: 'Read', input: { path: 'x' } });
    expect(r.risk).toBe('destructive');
    expect(r.backend).toBe('test-mock');

    const ps = new PermissionSystem();
    const result = ps.check({
      tool: { id: '1', name: 'Read', input: { path: 'x' } },
      mode: PermissionMode.AUTO,
      context: {} as any,
    });
    expect(result.allowed).toBe(false);
  });

  it('PACODE_CLASSIFIER=ml uses ml backend', () => {
    process.env['PACODE_CLASSIFIER'] = 'ml';
    const r = classifyToolCall({ id: '1', name: 'Read', input: { path: 'x' } });
    expect(r.backend).toBe('ml');
    expect(r.risk).toBe('safe');
  });

  it('unknown PACODE_CLASSIFIER falls back to deterministic', () => {
    process.env['PACODE_CLASSIFIER'] = 'not-a-real-backend';
    const r = classifyToolCall({ id: '1', name: 'Read', input: { path: 'x' } });
    expect(r.contract).toBe(CLASSIFIER_CONTRACT);
    expect(r.backend).toBe('deterministic');
    expect(r.risk).toBe('safe');
  });
});
