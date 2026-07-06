import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolDefinition, PermissionMode } from '../src/pkg/types.js';
import { registerBashTool } from '../src/tools/bash.js';
import { registerReadTool } from '../src/tools/read.js';
import { registerWriteTool } from '../src/tools/write.js';
import { registerEditTool } from '../src/tools/edit.js';
import { registerGlobTool } from '../src/tools/glob.js';
import { registerGrepTool } from '../src/tools/grep.js';
import { registerTaskTool } from '../src/tools/task.js';
import { registerTodoWriteTool } from '../src/tools/todowrite.js';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';

describe('Tool Registry - Deep', () => {
  let registry: ToolRegistry;
  beforeEach(() => { registry = new ToolRegistry(); });

  it('registers tool', () => {
    registry.register(createTool('T', 'd'));
    expect(registry.has('T')).toBe(true);
  });

  it('unregisters', () => {
    registry.register(createTool('X', 'd'));
    expect(registry.unregister('X')).toBe(true);
    expect(registry.has('X')).toBe(false);
  });

  it('unregister non-existent', () => {
    expect(registry.unregister('N')).toBe(false);
  });

  it('lists all', () => {
    registry.register(createTool('A', 'a'));
    registry.register(createTool('B', 'b'));
    expect(registry.list().length).toBe(2);
  });

  it('clears', () => {
    registry.register(createTool('A', 'a'));
    registry.clear();
    expect(registry.list().length).toBe(0);
  });

  it('handles duplicate registration', () => {
    registry.register(createTool('X', 'first'));
    registry.register(createTool('X', 'second'));
    expect(registry.get('X')?.description).toBe('second');
  });

  it('returns error for missing tool', async () => {
    const r = await registry.execute({ id: '1', name: 'N', input: {} }, { workingDirectory: process.cwd(), sessionState: {} as any, hooks: {} as any });
    expect(r.isError).toBe(true);
  });

  it('catches exceptions', async () => {
    registry.register({ name: 'F', description: '', inputSchema: {}, concurrencySafe: true, permissionMode: PermissionMode.DEFAULT, async execute() { throw new Error('Boom'); } });
    const r = await registry.execute({ id: '1', name: 'F', input: {} }, { workingDirectory: process.cwd(), sessionState: {} as any, hooks: {} as any });
    expect(r.isError).toBe(true);
  });

  it('all 8 tools register', () => {
    registerBashTool(registry);
    registerReadTool(registry);
    registerWriteTool(registry);
    registerEditTool(registry);
    registerGlobTool(registry);
    registerGrepTool(registry);
    registerTaskTool(registry);
    registerTodoWriteTool(registry);
    expect(registry.list().length).toBe(8);
  });

  it('Bash not concurrency safe', () => {
    registerBashTool(registry);
    expect(registry.get('Bash')?.concurrencySafe).toBe(false);
  });

  it('Read concurrency safe', () => {
    registerReadTool(registry);
    expect(registry.get('Read')?.concurrencySafe).toBe(true);
  });

  it('Read reads a file', async () => {
    registerReadTool(registry);
    const f = '/tmp/pacode-test-r.txt';
    writeFileSync(f, 'hello');
    try {
      const r = await registry.execute({ id: '1', name: 'Read', input: { path: f } }, { workingDirectory: process.cwd(), sessionState: {} as any, hooks: {} as any });
      expect(r.isError).toBeFalsy();
      expect(r.content[0]?.text).toBe('hello');
    } finally { if (existsSync(f)) unlinkSync(f); }
  });

  it('Write writes a file', async () => {
    registerWriteTool(registry);
    const f = '/tmp/pacode-test-w.txt';
    try {
      await registry.execute({ id: '1', name: 'Write', input: { path: f, content: 'data' } }, { workingDirectory: process.cwd(), sessionState: {} as any, hooks: {} as any });
      expect(existsSync(f)).toBe(true);
    } finally { if (existsSync(f)) unlinkSync(f); }
  });

  it('Edit edits a file', async () => {
    registerEditTool(registry);
    const f = '/tmp/pacode-test-e.txt';
    writeFileSync(f, 'Hello World');
    try {
      await registry.execute({ id: '1', name: 'Edit', input: { path: f, oldText: 'World', newText: 'PaCode' } }, { workingDirectory: process.cwd(), sessionState: {} as any, hooks: {} as any });
    } finally { if (existsSync(f)) unlinkSync(f); }
  });

  it('TodoWrite creates todo', async () => {
    registerTodoWriteTool(registry);
    const r = await registry.execute({ id: '1', name: 'TodoWrite', input: { action: 'create', content: 't' } }, { workingDirectory: process.cwd(), sessionState: {} as any, hooks: {} as any });
    expect(r.isError).toBeFalsy();
  });

  function createTool(name: string, description: string): ToolDefinition {
    return { name, description, inputSchema: {}, concurrencySafe: true, permissionMode: PermissionMode.DEFAULT, async execute() { return { content: [{ type: 'text', text: 'ok' }] }; } };
  }
});
