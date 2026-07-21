/**
 * Skills 渐进披露 (progressive disclosure)
 * loadIndex 只解析元数据（不驻留全文）；loadContent 按需读全文。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillsLoader } from '../src/skills/loader.js';

const bigBody = 'STEP DETAIL '.repeat(500);
const sampleSkillMd = `# Lint Fix

## Description
Fix lint issues in the codebase.

## When to Use
- ESLint failures

## Workflow
1. Run linter
2. Fix issues

## Notes
${bigBody}
`;

describe('SkillsLoader — progressive disclosure', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `pacode-prog-${Date.now()}-${Math.random()}`);
    mkdirSync(join(dir, 'lint-fix'), { recursive: true });
    writeFileSync(join(dir, 'lint-fix', 'SKILL.md'), sampleSkillMd);
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('loadIndex parses metadata without retaining full body', async () => {
    const loader = new SkillsLoader(dir);
    const index = await loader.loadIndex();

    expect(index.size).toBe(1);
    const entry = loader.listIndex()[0]!;
    expect(entry.name).toBe('Lint Fix');
    expect(entry.description).toBe('Fix lint issues in the codebase.');

    // index 阶段不应把大正文驻留在内存里
    const skill = loader.get('lint-fix')!;
    expect(skill.content).not.toContain('STEP DETAIL');
  });

  it('loadContent reads full SKILL.md on demand', async () => {
    const loader = new SkillsLoader(dir);
    await loader.loadIndex();

    const content = await loader.loadContent('lint-fix');
    expect(content).toContain('STEP DETAIL');
    expect(content).toContain('## Workflow');
  });

  it('loadContent caches the body into the skill entry', async () => {
    const loader = new SkillsLoader(dir);
    await loader.loadIndex();
    await loader.loadContent('lint-fix');

    expect(loader.get('lint-fix')!.content).toContain('STEP DETAIL');
  });

  it('loadContent returns null for unknown skill', async () => {
    const loader = new SkillsLoader(dir);
    await loader.loadIndex();
    expect(await loader.loadContent('nope')).toBeNull();
  });

  it('loadContent resolves by display name too', async () => {
    const loader = new SkillsLoader(dir);
    await loader.loadIndex();
    const content = await loader.loadContent('Lint Fix');
    expect(content).toContain('STEP DETAIL');
  });

  it('loadIndex is idempotent (no duplicate entries)', async () => {
    const loader = new SkillsLoader(dir);
    await loader.loadIndex();
    await loader.loadIndex();
    expect(loader.listIndex()).toHaveLength(1);
  });
});
