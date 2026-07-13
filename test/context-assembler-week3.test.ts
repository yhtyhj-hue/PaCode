/**
 * Week 3 Context Assembler tests — 9 sources
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { ContextAssembler } from '../src/context/assembler.js';
import { getTodoStore, resetTodoStore } from '../src/context/todo-store.js';
import { PermissionMode, ToolDefinition } from '../src/pkg/types.js';

const emptyState = {
  sessionId: 'sess-week3',
  messages: [],
  toolCallHistory: [],
  maxOutputTokensRecoveryCount: 0,
  mode: PermissionMode.DEFAULT,
  hooks: { hooks: {} },
  compactionHistory: [],
};

describe('ContextAssembler — 9 sources', () => {
  beforeEach(() => {
    resetTodoStore();
  });

  it('includes Working Memory when messages exist', async () => {
    const assembler = new ContextAssembler();
    const context = await assembler.assemble({
      ...emptyState,
      messages: [
        { role: 'user', content: 'hello world', timestamp: 1 },
        { role: 'assistant', content: 'hi', timestamp: 2 },
      ],
    });

    expect(context.systemPrompt).toContain('## Working Memory');
    expect(context.systemPrompt).toContain('Messages in session: 2');
    expect(context.systemPrompt).toContain('hello world');
  });

  it('includes Task Context from TodoStore', async () => {
    getTodoStore().create('sess-week3', 'implement Week 3');
    const assembler = new ContextAssembler();
    const context = await assembler.assemble(emptyState);

    expect(context.systemPrompt).toContain('## Task Context');
    expect(context.systemPrompt).toContain('implement Week 3');
  });

  it('includes tool catalog when tools provided', async () => {
    const tools: ToolDefinition[] = [
      {
        name: 'Read',
        description: 'Read a file',
        inputSchema: {},
        concurrencySafe: true,
        permissionMode: PermissionMode.DEFAULT,
        async execute() {
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      },
    ];

    const assembler = new ContextAssembler();
    const context = await assembler.assemble(emptyState, { tools });

    expect(context.systemPrompt).toContain('## Available Tools');
    expect(context.systemPrompt).toContain('Read: Read a file');
    expect(context.tools).toHaveLength(1);
  });

  it('includes Recent Results from tool_result blocks', async () => {
    const assembler = new ContextAssembler();
    const context = await assembler.assemble({
      ...emptyState,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 't1',
              toolResult: {
                content: [{ type: 'text', text: 'file contents here' }],
              },
            },
          ],
          timestamp: 1,
        },
      ],
    });

    expect(context.systemPrompt).toContain('## Recent Results');
    expect(context.systemPrompt).toContain('file contents here');
  });

  it('includes Project context from package.json', async () => {
    const assembler = new ContextAssembler();
    const context = await assembler.assemble(emptyState);

    expect(context.systemPrompt).toContain('## Project');
    expect(context.systemPrompt).toMatch(/Project:|README excerpt:/);
  });

  it('computes tokenCount from system prompt and messages', async () => {
    const assembler = new ContextAssembler();
    const context = await assembler.assemble({
      ...emptyState,
      messages: [{ role: 'user', content: 'x'.repeat(400), timestamp: 1 }],
    }, { systemPrompt: 'You are PaCode' });

    expect(context.tokenCount).toBeGreaterThan(100);
  });
});

describe('ContextAssembler — user rules', () => {
  let rulesDir: string;

  beforeEach(() => {
    rulesDir = join(tmpdir(), `pacode-rules-${Date.now()}`);
    mkdirSync(join(rulesDir, 'rules'), { recursive: true });
    writeFileSync(join(rulesDir, 'rules', 'custom.md'), 'Always use TypeScript');
  });

  afterEach(() => {
    if (existsSync(rulesDir)) rmSync(rulesDir, { recursive: true, force: true });
  });

  it('loads user rules from ~/.paude/rules when present', async () => {
    const userRules = join(homedir(), '.paude', 'rules');
    const testFile = join(userRules, `test-${Date.now()}.md`);
    let created = false;

    try {
      mkdirSync(userRules, { recursive: true });
      writeFileSync(testFile, 'Test user rule content');
      created = true;

      const assembler = new ContextAssembler();
      const context = await assembler.assemble(emptyState);
      expect(context.systemPrompt).toContain('Test user rule content');
    } finally {
      if (created && existsSync(testFile)) rmSync(testFile, { force: true });
    }
  });
});
