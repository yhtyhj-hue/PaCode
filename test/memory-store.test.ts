import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore, getMemoryStore, resetMemoryStore } from '../src/memory/store.js';
import {
  computeProjectHash,
  getProjectMemoryDir,
  getProjectMemoryRoot,
  loadProjectMemoryMarkdown,
  resolveProjectRoot,
} from '../src/memory/project.js';
import { MemoryType, PermissionMode } from '../src/pkg/types.js';
import { ContextAssembler } from '../src/context/assembler.js';

describe('project memory paths', () => {
  it('computeProjectHash is stable for same path', () => {
    const a = computeProjectHash('/tmp/my-project');
    const b = computeProjectHash('/tmp/my-project');
    expect(a).toBe(b);
    expect(a).toHaveLength(12);
  });

  it('getProjectMemoryRoot uses hash subdirectory', () => {
    const projectRoot = resolveProjectRoot(process.cwd());
    const root = getProjectMemoryRoot(projectRoot);
    expect(root).toContain(join('.paude', 'projects'));
    expect(root).toContain(computeProjectHash(projectRoot));
  });
});

describe('loadProjectMemoryMarkdown', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `pacode-proj-md-${Date.now()}`);
    const memRoot = join(projectRoot, '.paude', 'projects', computeProjectHash(projectRoot));
    mkdirSync(join(memRoot, 'decisions'), { recursive: true });
    writeFileSync(join(memRoot, 'architecture.md'), '# Auth\n\nJWT based auth');
    writeFileSync(join(memRoot, 'decisions', '2026-refactor.md'), 'Use session tokens');
  });

  afterEach(() => {
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('loads markdown files from project memory root', () => {
    const text = loadProjectMemoryMarkdown(projectRoot);
    expect(text).toContain('architecture.md');
    expect(text).toContain('JWT based auth');
    expect(text).toContain('decisions/2026-refactor.md');
  });
});

describe('MemoryStore.search', () => {
  let memoryDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    memoryDir = join(tmpdir(), `pacode-mem-${Date.now()}-${Math.random()}`);
    store = new MemoryStore({ memoryDir, includeProject: false });
  });

  afterEach(() => {
    if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true, force: true });
  });

  it('returns all memories when query is empty', async () => {
    await store.write(
      { scope: 'user', category: 'pref', id: 'theme' },
      {
        key: { scope: 'user', category: 'pref', id: 'theme' },
        type: MemoryType.PREFERENCE,
        content: 'dark mode preferred',
        metadata: { created: 1, updated: 2, tags: [], version: 1 },
      }
    );

    const results = await store.search('');
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toContain('dark mode');
  });

  it('filters by query text', async () => {
    await store.write(
      { scope: 'user', category: 'pref', id: 'a' },
      {
        key: { scope: 'user', category: 'pref', id: 'a' },
        type: MemoryType.PREFERENCE,
        content: 'typescript strict mode',
        metadata: { created: 1, updated: 1, tags: [], version: 1 },
      }
    );
    await store.write(
      { scope: 'user', category: 'pref', id: 'b' },
      {
        key: { scope: 'user', category: 'pref', id: 'b' },
        type: MemoryType.PREFERENCE,
        content: 'python lint rules',
        metadata: { created: 1, updated: 1, tags: [], version: 1 },
      }
    );

    const results = await store.search('typescript');
    expect(results).toHaveLength(1);
    expect(results[0]?.key.id).toBe('a');
  });

  it('respects limit option', async () => {
    for (let i = 0; i < 5; i++) {
      await store.write(
        { scope: 'user', category: 'note', id: `n${i}` },
        {
          key: { scope: 'user', category: 'note', id: `n${i}` },
          type: MemoryType.PATTERN,
          content: `note ${i}`,
          metadata: { created: i, updated: i, tags: [], version: 1 },
        }
      );
    }

    const results = await store.search('', { limit: 2 });
    expect(results).toHaveLength(2);
  });
});

describe('MemoryStore — project scope', () => {
  let projectRoot: string;
  let store: MemoryStore;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `pacode-proj-mem-${Date.now()}`);
    store = new MemoryStore({ memoryDir: join(projectRoot, 'user-mem'), projectRoot });
  });

  afterEach(() => {
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('stores project memories under .paude/projects/{hash}/memory', async () => {
    await store.write(
      { scope: 'project', category: 'arch', id: 'overview' },
      {
        key: { scope: 'project', category: 'arch', id: 'overview' },
        type: MemoryType.ARCHITECTURE,
        content: 'monorepo with services-first layout',
        metadata: { created: 1, updated: 1, tags: [], version: 1 },
      }
    );

    const expectedDir = getProjectMemoryDir(projectRoot);
    expect(store.getProjectMemoryDir()).toBe(expectedDir);
    expect(
      existsSync(join(expectedDir, 'project', 'arch', 'overview.json'))
    ).toBe(true);

    const results = await store.search('', { scope: 'project' });
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toContain('monorepo');
  });

  it('formatForContext merges markdown and JSON project memory', async () => {
    const memRoot = getProjectMemoryRoot(projectRoot);
    mkdirSync(memRoot, { recursive: true });
    writeFileSync(join(memRoot, 'codebase_map.md'), 'src/agent/engine.ts is core loop');

    await store.write(
      { scope: 'project', category: 'decision', id: 'auth' },
      {
        key: { scope: 'project', category: 'decision', id: 'auth' },
        type: MemoryType.DECISION,
        content: 'use JWT sessions',
        metadata: { created: 1, updated: 1, tags: [], version: 1 },
      }
    );

    const formatted = await store.formatForContext();
    expect(formatted).toContain('codebase_map.md');
    expect(formatted).toContain('engine.ts');
    expect(formatted).toContain('JWT sessions');
  });
});

describe('MemoryStore CRUD', () => {
  let memoryDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    memoryDir = join(tmpdir(), `pacode-mem-crud-${Date.now()}`);
    store = new MemoryStore({ memoryDir, includeProject: false });
  });

  afterEach(() => {
    resetMemoryStore();
    if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true, force: true });
  });

  it('read write append delete round-trip', async () => {
    const key = { scope: 'user' as const, category: 'note', id: 'n1' };
    await store.write(key, {
      key,
      type: MemoryType.PATTERN,
      content: 'line1',
      metadata: { created: 1, updated: 1, tags: [], version: 1 },
    });
    expect((await store.read(key))?.content).toBe('line1');

    await store.append(key, 'line2');
    expect((await store.read(key))?.content).toContain('line2');

    await store.delete(key);
    expect(await store.read(key)).toBeNull();
  });

  it('getMemoryStore returns singleton', () => {
    resetMemoryStore();
    const a = getMemoryStore({ memoryDir, includeProject: false });
    const b = getMemoryStore();
    expect(a).toBe(b);
  });
});

describe('ContextAssembler memory integration', () => {
  let memoryDir: string;

  beforeEach(async () => {
    memoryDir = join(tmpdir(), `pacode-ctx-${Date.now()}-${Math.random()}`);
    const store = new MemoryStore({ memoryDir, includeProject: false });
    await store.write(
      { scope: 'user', category: 'pref', id: 'lang' },
      {
        key: { scope: 'user', category: 'pref', id: 'lang' },
        type: MemoryType.PREFERENCE,
        content: 'respond in Chinese',
        metadata: { created: 1, updated: 1, tags: [], version: 1 },
      }
    );
  });

  afterEach(() => {
    if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true, force: true });
  });

  it('includes memory in system prompt', async () => {
    const assembler = new ContextAssembler({ memoryDir });
    const context = await assembler.assemble({
      sessionId: 's1',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    });

    expect(context.systemPrompt).toContain('## Memory');
    expect(context.systemPrompt).toContain('respond in Chinese');
  });
});
