/**
 * K1 — SkillTool / ToolSearch 延迟加载
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerSkillTools, searchTools } from '../src/tools/skill-tools.js';
import { registerCoreTools } from '../src/tools/bootstrap.js';
import { SkillsLoader } from '../src/skills/loader.js';
import { ContextAssembler } from '../src/context/assembler.js';
import { formatSkillsLazyIndex } from '../src/context/assembler-helpers.js';
import { PermissionMode } from '../src/pkg/types.js';

const ctx = {
  workingDirectory: process.cwd(),
  sessionState: {} as never,
  hooks: {} as never,
};

const sampleSkillMd = `# Lint Fix

## Description
Fix lint issues in the codebase.

## When to Use
- ESLint failures

## Workflow
1. Run linter
2. Fix issues
`;

describe('K1 searchTools', () => {
  it('ranks Grep above unrelated tools', () => {
    const reg = new ToolRegistry();
    registerCoreTools(reg, { task: { toolRegistry: reg } });
    const hits = searchTools(reg, 'grep');
    expect(hits[0]?.name).toBe('Grep');
  });
});

describe('K1 SkillTool + ToolSearch', () => {
  let skillsDir: string;
  let loader: SkillsLoader;

  beforeEach(async () => {
    skillsDir = join(tmpdir(), `pacode-k1-${Date.now()}`);
    mkdirSync(join(skillsDir, 'lint-fix'), { recursive: true });
    writeFileSync(join(skillsDir, 'lint-fix', 'SKILL.md'), sampleSkillMd);
    loader = new SkillsLoader(skillsDir);
    await loader.loadAll();
  });

  afterEach(() => {
    if (existsSync(skillsDir)) rmSync(skillsDir, { recursive: true, force: true });
  });

  it('loads full SKILL.md by id', async () => {
    const reg = new ToolRegistry();
    registerSkillTools(reg, { toolRegistry: reg, skillsLoader: loader });

    const result = await reg.execute(
      { id: '1', name: 'SkillTool', input: { name: 'lint-fix' } },
      ctx
    );
    expect(result.isError).toBeFalsy();
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.id).toBe('lint-fix');
    expect(body.content).toContain('## Workflow');
    expect(body.workflow).toContain('Run linter');
  });

  it('lists index without full body', async () => {
    const reg = new ToolRegistry();
    registerSkillTools(reg, { toolRegistry: reg, skillsLoader: loader });
    const result = await reg.execute(
      { id: '1', name: 'SkillTool', input: { action: 'list' } },
      ctx
    );
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.skills[0].id).toBe('lint-fix');
    expect(JSON.stringify(body)).not.toContain('## Workflow');
  });

  it('ToolSearch finds Grep', async () => {
    const reg = new ToolRegistry();
    registerCoreTools(reg, { task: { toolRegistry: reg }, skillsLoader: loader });
    const result = await reg.execute(
      { id: '1', name: 'ToolSearch', input: { query: 'grep pattern' } },
      ctx
    );
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.tools.some((t: { name: string }) => t.name === 'Grep')).toBe(true);
  });

  it('miss returns indexed ids', async () => {
    const reg = new ToolRegistry();
    registerSkillTools(reg, { toolRegistry: reg, skillsLoader: loader });
    const result = await reg.execute(
      { id: '1', name: 'SkillTool', input: { name: 'nope-skill' } },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('lint-fix');
  });
});

describe('K1 lazy assembler index', () => {
  it('formatSkillsLazyIndex omits workflow blocks', () => {
    const text = formatSkillsLazyIndex([
      {
        name: 'Debug',
        description: 'debug stuff',
        whenToUse: ['bugs'],
        tools: ['Read'],
        workflow: ['Step one that must not appear'],
        content: 'FULL BODY',
        source: 'debug',
      },
    ]);
    expect(text).toContain('SkillTool');
    expect(text).toContain('debug');
    expect(text).not.toContain('Step one that must not appear');
    expect(text).not.toContain('FULL BODY');
  });

  it('ContextAssembler default has no When to use / Workflow', async () => {
    const assembler = new ContextAssembler();
    const context = await assembler.assemble({
      sessionId: 'k1',
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    });
    expect(context.systemPrompt).toContain('## Skills');
    expect(context.systemPrompt).toContain('SkillTool');
    expect(context.systemPrompt).not.toContain('**When to use:**');
    expect(context.systemPrompt).not.toContain('**Workflow:**');
  });

  it('bootstrap registers SkillTool and ToolSearch (24 tools)', () => {
    const reg = new ToolRegistry();
    registerCoreTools(reg, { task: { toolRegistry: reg } });
    expect(reg.has('SkillTool')).toBe(true);
    expect(reg.has('ToolSearch')).toBe(true);
    expect(reg.list()).toHaveLength(24);
  });
});
