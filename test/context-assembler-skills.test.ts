/**
 * Skills structured context + parser tests (D2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillsLoader } from '../src/skills/loader.js';
import { ContextAssembler } from '../src/context/assembler.js';
import { formatSkillsCatalog } from '../src/context/assembler-helpers.js';
import { PermissionMode } from '../src/pkg/types.js';

const emptyState = {
  sessionId: 'sess-skills',
  messages: [],
  toolCallHistory: [],
  maxOutputTokensRecoveryCount: 0,
  mode: PermissionMode.DEFAULT,
  hooks: { hooks: {} },
  compactionHistory: [],
};

const sampleSkillMd = `# Lint Fix

## Description
Fix lint issues in the codebase.

## When to Use
- ESLint failures
- Type errors in CI

## Tools
- Bash: run lint
- Edit: apply fixes

## Workflow
1. Run linter
2. Fix reported issues
3. Re-run to verify
`;

describe('SkillsLoader — structured parse', () => {
  let skillsDir: string;

  beforeEach(() => {
    skillsDir = join(tmpdir(), `pacode-skill-parse-${Date.now()}`);
    mkdirSync(join(skillsDir, 'lint-fix'), { recursive: true });
    writeFileSync(join(skillsDir, 'lint-fix', 'SKILL.md'), sampleSkillMd);
  });

  afterEach(() => {
    if (existsSync(skillsDir)) rmSync(skillsDir, { recursive: true, force: true });
  });

  it('parses description, whenToUse, tools, and numbered workflow', async () => {
    const loader = new SkillsLoader(skillsDir);
    await loader.loadAll();
    const skill = loader.get('lint-fix');

    expect(skill?.name).toBe('Lint Fix');
    expect(skill?.description).toContain('Fix lint issues');
    expect(skill?.whenToUse).toEqual(['ESLint failures', 'Type errors in CI']);
    expect(skill?.tools.some((t) => t.includes('Bash'))).toBe(true);
    expect(skill?.workflow).toEqual([
      'Run linter',
      'Fix reported issues',
      'Re-run to verify',
    ]);
  });
});

describe('formatSkillsCatalog', () => {
  it('formats structured skill metadata', async () => {
    const loader = new SkillsLoader(join(process.cwd(), '.claude/skills'));
    await loader.loadAll();
    const catalog = formatSkillsCatalog(loader.list());

    expect(catalog).toContain('### Debug');
    expect(catalog).toContain('**When to use:**');
    expect(catalog).not.toContain('## Description');
  });
});

describe('ContextAssembler — skills source', () => {
  let skillsDir: string;

  beforeEach(() => {
    skillsDir = join(tmpdir(), `pacode-asm-skills-${Date.now()}`);
    mkdirSync(join(skillsDir, 'lint-fix'), { recursive: true });
    writeFileSync(join(skillsDir, 'lint-fix', 'SKILL.md'), sampleSkillMd);
  });

  afterEach(() => {
    if (existsSync(skillsDir)) rmSync(skillsDir, { recursive: true, force: true });
  });

  it('includes lazy skill index via skillsLoader (K1)', async () => {
    const loader = new SkillsLoader(skillsDir);
    await loader.loadAll();

    const assembler = new ContextAssembler({ skillsLoader: loader });
    const context = await assembler.assemble(emptyState);

    expect(context.systemPrompt).toContain('## Skills');
    expect(context.systemPrompt).toContain('SkillTool');
    expect(context.systemPrompt).toContain('lint-fix');
    expect(context.systemPrompt).toContain('Fix lint issues');
    expect(context.systemPrompt).not.toContain('**When to use:**');
    expect(context.systemPrompt).not.toContain('**Workflow:**');
  });

  it('includes bundled project skills as lazy index by default', async () => {
    const assembler = new ContextAssembler();
    const context = await assembler.assemble(emptyState);

    expect(context.systemPrompt).toContain('## Skills');
    expect(context.systemPrompt).toContain('SkillTool');
    expect(context.systemPrompt).toContain('debug');
    expect(context.systemPrompt).not.toContain('**Workflow:**');
  });

  it('skillsFullCatalog opt-in restores workflow blocks', async () => {
    const assembler = new ContextAssembler();
    const context = await assembler.assemble(emptyState, {
      skillsFullCatalog: true,
      skills: [
        {
          name: 'Custom',
          description: 'A custom skill',
          whenToUse: ['custom tasks'],
          tools: ['Read'],
          workflow: ['Do thing'],
          content: '',
        },
      ],
    });

    expect(context.systemPrompt).toContain('### Custom');
    expect(context.systemPrompt).toContain('custom tasks');
    expect(context.systemPrompt).toContain('**Workflow:**');
  });
});
