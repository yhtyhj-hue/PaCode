import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolDefinition, PermissionMode } from '../src/pkg/types.js';
import { registerCoreTools } from '../src/tools/bootstrap.js';
import { registerReadTool } from '../src/tools/read.js';
import { registerWriteTool } from '../src/tools/write.js';
import { registerEditTool } from '../src/tools/edit.js';
import { registerTodoWriteTool } from '../src/tools/todowrite.js';
import { writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

  it('all 9 tools register', () => {
    registerCoreTools(registry, { task: { toolRegistry: registry } });
    expect(registry.list().length).toBe(9);
  });

  it('Bash not concurrency safe', () => {
    registerCoreTools(registry, { task: { toolRegistry: registry } });
    expect(registry.get('Bash')?.concurrencySafe).toBe(false);
  });

  it('Bash uses DEFAULT permission mode', () => {
    registerCoreTools(registry, { task: { toolRegistry: registry } });
    expect(registry.get('Bash')?.permissionMode).toBe(PermissionMode.DEFAULT);
  });

  it('Read concurrency safe', () => {
    registerCoreTools(registry, { task: { toolRegistry: registry } });
    expect(registry.get('Read')?.concurrencySafe).toBe(true);
  });

  it('Read reads a file within workspace', async () => {
    registerReadTool(registry);
    const workDir = mkdtempSync(join(tmpdir(), 'pacode-read-'));
    const f = join(workDir, 'test.txt');
    writeFileSync(f, 'hello');
    try {
      const r = await registry.execute(
        { id: '1', name: 'Read', input: { path: 'test.txt' } },
        { workingDirectory: workDir, sessionState: {} as never, hooks: {} as never }
      );
      expect(r.isError).toBeFalsy();
      expect((r.content[0] as { type: 'text'; text: string }).text).toBe('hello');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('Read blocks path traversal', async () => {
    registerReadTool(registry);
    const r = await registry.execute(
      { id: '1', name: 'Read', input: { path: '../../../etc/passwd' } },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );
    expect(r.isError).toBe(true);
    expect((r.content[0] as { type: 'text'; text: string }).text).toContain('escapes workspace');
  });

  it('Write writes a file within workspace', async () => {
    registerWriteTool(registry);
    const workDir = mkdtempSync(join(tmpdir(), 'pacode-write-'));
    const f = join(workDir, 'out.txt');
    try {
      await registry.execute(
        { id: '1', name: 'Write', input: { path: 'out.txt', content: 'data' } },
        { workingDirectory: workDir, sessionState: {} as never, hooks: {} as never }
      );
      expect(existsSync(f)).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('Edit edits a file within workspace', async () => {
    registerEditTool(registry);
    const workDir = mkdtempSync(join(tmpdir(), 'pacode-edit-'));
    const f = join(workDir, 'edit.txt');
    writeFileSync(f, 'Hello World');
    try {
      await registry.execute(
        { id: '1', name: 'Edit', input: { path: 'edit.txt', oldText: 'World', newText: 'PaCode' } },
        { workingDirectory: workDir, sessionState: {} as never, hooks: {} as never }
      );
      expect(existsSync(f)).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('TodoWrite creates todo scoped to session', async () => {
    registerTodoWriteTool(registry);
    const sessionState = { sessionId: 'todo-test-session' } as any;
    const r = await registry.execute(
      { id: '1', name: 'TodoWrite', input: { action: 'create', content: 't' } },
      { workingDirectory: process.cwd(), sessionState, hooks: {} as any }
    );
    expect(r.isError).toBeFalsy();

    const list = await registry.execute(
      { id: '2', name: 'TodoWrite', input: { action: 'list' } },
      { workingDirectory: process.cwd(), sessionState: { sessionId: 'other' } as any, hooks: {} as any }
    );
    expect((list.content[0] as { type: 'text'; text: string }).text).toBe('No tasks');
  });

  function createTool(name: string, description: string): ToolDefinition {
    return { name, description, inputSchema: {}, concurrencySafe: true, permissionMode: PermissionMode.DEFAULT, async execute() { return { content: [{ type: 'text' as const, text: 'ok' }] }; } };
  }
});
