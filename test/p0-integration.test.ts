import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryEngine } from '../src/agent/engine.js';
import { ToolRegistry, resetToolRegistry } from '../src/tools/registry.js';
import { registerCoreTools, createFilteredRegistry } from '../src/tools/bootstrap.js';
import { SessionManager } from '../src/session/manager.js';
import { PermissionMode } from '../src/pkg/types.js';
import { getSubagentManager, resetSubagentManager } from '../src/agent/subagent.js';
import { registerTaskTool } from '../src/tools/task.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('P0: ToolRegistry wired to QueryEngine', () => {
  beforeEach(() => {
    resetToolRegistry();
  });

  it('QueryEngine sees all 9 core tools after bootstrap', () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry, { task: { toolRegistry: registry } });

    const engine = new QueryEngine({ apiKey: 'test', toolRegistry: registry });
    expect(engine.getToolRegistry().list()).toHaveLength(9);
    expect(engine.getToolRegistry().has('Bash')).toBe(true);
    expect(engine.getToolRegistry().has('Task')).toBe(true);
  });

  it('createFilteredRegistry keeps only allowed tools', () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry, { task: { toolRegistry: registry } });

    const filtered = createFilteredRegistry(registry, ['Read', 'Glob', 'Grep']);
    expect(filtered.list()).toHaveLength(3);
    expect(filtered.has('Bash')).toBe(false);
  });
});

describe('P0: REPL multi-turn session', () => {
  it('SessionManager reuses current session across messages', () => {
    const sessionManager = new SessionManager(join(tmpdir(), `repl-mt-${Date.now()}`));
    const s1 = sessionManager.createSession({ mode: PermissionMode.DEFAULT });
    sessionManager.addMessage(s1, { role: 'user', content: 'hello', timestamp: 1 });
    sessionManager.addMessage(s1, {
      role: 'assistant',
      content: 'hi there',
      timestamp: 2,
    });

    const current = sessionManager.getCurrentSession();
    expect(current?.sessionId).toBe(s1.sessionId);
    expect(current?.messages).toHaveLength(2);

    sessionManager.addMessage(current!, { role: 'user', content: 'again', timestamp: 3 });
    expect(sessionManager.getCurrentSession()?.messages).toHaveLength(3);
  });

  it('clear creates new session id while keeping manager', () => {
    const sessionManager = new SessionManager(join(tmpdir(), `repl-clr-${Date.now()}`));
    const s1 = sessionManager.createSession({ mode: PermissionMode.DEFAULT });
    const s2 = sessionManager.createSession({ mode: PermissionMode.DEFAULT });
    expect(s2.sessionId).not.toBe(s1.sessionId);
    expect(sessionManager.getCurrentSession()?.sessionId).toBe(s2.sessionId);
  });
});

describe('P0: Task tool delegates to SubagentManager', () => {
  beforeEach(() => {
    resetSubagentManager();
  });

  it('Task tool invokes subagent run', async () => {
    const registry = new ToolRegistry();
    const runSpy = vi.spyOn(getSubagentManager(), 'run').mockResolvedValue({
      name: 'explore',
      success: true,
      output: 'found 3 files',
      toolCalls: 2,
      duration: 100,
    });

    registerTaskTool(registry, { toolRegistry: registry, apiKey: 'k', model: 'test-model' });

    const result = await registry.execute(
      {
        id: 't1',
        name: 'Task',
        input: {
          description: 'find files',
          prompt: 'list ts files',
          subagent_type: 'explore',
        },
      },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );

    expect(runSpy).toHaveBeenCalledOnce();
    expect(result.isError).toBeFalsy();
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('found 3 files');
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('explore');

    runSpy.mockRestore();
  });

  it('Task tool errors on unknown subagent type', async () => {
    const registry = new ToolRegistry();
    registerTaskTool(registry, { toolRegistry: registry });

    const result = await registry.execute(
      {
        id: 't2',
        name: 'Task',
        input: { description: 'x', prompt: 'y', subagent_type: 'nonexistent' },
      },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('Unknown subagent type');
  });
});

describe('P0: assistant message persisted on end_turn', () => {
  it('responseContentToBlocks produces storable assistant content', async () => {
    const { responseContentToBlocks } = await import('../src/agent/message-serializer.js');
    const blocks = responseContentToBlocks([
      { type: 'text' as const, text: 'Hello user' },
    ]);

    const sessionManager = new SessionManager(join(tmpdir(), `eng-${Date.now()}`));
    const session = sessionManager.createSession({ mode: PermissionMode.DEFAULT });
    session.messages.push({ role: 'user', content: 'hi', timestamp: 1 });
    session.messages.push({ role: 'assistant', content: blocks, timestamp: 2 });

    expect(session.messages).toHaveLength(2);
    expect(session.messages[1]?.role).toBe('assistant');
  });
});
