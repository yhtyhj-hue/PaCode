/**
 * K3 — Brief as skill + /brief slash (not a core tool)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProjectBrief, formatProjectBrief } from '../src/services/brief/index.js';
import { SkillsLoader } from '../src/skills/loader.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerCoreTools } from '../src/tools/bootstrap.js';
import { BUILTIN_SLASH_COMMANDS } from '../src/cli/slash-menu.js';

describe('K3 buildProjectBrief', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `pacode-k3-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'CLAUDE.md'), '# Rules\nBe careful.\n');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'demo-app',
        version: '1.2.3',
        scripts: { test: 'vitest', build: 'tsc' },
        dependencies: { zod: '3.0.0' },
      })
    );
    writeFileSync(join(dir, 'README.md'), '# Demo\nHello world.\n');
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('collects present sections and skips inventing missing ones', () => {
    const brief = buildProjectBrief(dir);
    expect(brief.sections.find((s) => s.name === 'CLAUDE.md')?.present).toBe(true);
    expect(brief.sections.find((s) => s.name === 'package.json')?.excerpt).toContain('demo-app');
    expect(brief.sections.find((s) => s.name === 'README')?.excerpt).toContain('Hello world');
    expect(brief.summary).toContain('Present:');
    expect(brief.summary).not.toContain('Missing: CLAUDE.md');
  });

  it('marks missing README without fabricating content', () => {
    rmSync(join(dir, 'README.md'));
    const brief = buildProjectBrief(dir);
    const readme = brief.sections.find((s) => s.name === 'README');
    expect(readme?.present).toBe(false);
    expect(readme?.excerpt).toBe('(missing)');
    expect(formatProjectBrief(brief)).toContain('(missing)');
  });
});

describe('K3 Brief skill exists', () => {
  it('loads brief skill via SkillsLoader', async () => {
    const loader = new SkillsLoader(join(process.cwd(), '.claude/skills'));
    await loader.loadAll();
    const skill = loader.resolve('brief');
    expect(skill).toBeTruthy();
    expect(skill!.content).toContain('/brief');
    expect(skill!.content).toContain('CLAUDE.md');
  });

  it('/brief is a builtin slash, not BriefTool', () => {
    expect(BUILTIN_SLASH_COMMANDS.some((c) => c.command === '/brief')).toBe(true);
    const reg = new ToolRegistry();
    registerCoreTools(reg, { task: { toolRegistry: reg } });
    expect(reg.has('BriefTool')).toBe(false);
    expect(reg.has('ConfigTool')).toBe(true);
  });

  it('brief SKILL.md is on disk', () => {
    const path = join(process.cwd(), '.claude/skills/brief/SKILL.md');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf-8')).toContain('When to Use');
  });
});
