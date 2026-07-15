/**
 * Skill Mount — Tests
 *
 * Uses real tmpdir + real files to exercise the discover → parse → merge
 * pipeline. No mocks: the whole point of this layer is that it talks to the
 * filesystem, so we let it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { platform } from 'node:process';

import {
  loadExternalSkills,
  discoverSkillFiles,
  parseFrontmatter,
  stripFrontmatter,
  mergeMountedSkills,
  normalizeId,
  defaultRoots,
} from '../../src/services/skill-mount/index.js';
import type { SkillMountConfig, SkillSource } from '../../src/services/skill-mount/types.js';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'pacode-skill-mount-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeSkill(
  dir: string,
  name: string,
  body: string
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, 'SKILL.md');
  await writeFile(filePath, body, 'utf-8');
  return filePath;
}

function makeConfig(
  roots: SkillSource[],
  overrides: Partial<SkillMountConfig> = {}
): SkillMountConfig {
  return { roots, ...overrides };
}

const SIMPLE_SKILL = `---
name: Hello World
description: Says hello.
when_to_use: greeting, casual
tools: Bash, Read
---

# Hello World

Greet the user.
`;

const NO_FRONTMATTER = `# Just a title

No frontmatter at all.
`;

const MISSING_NAME = `---
description: missing name field
---

body
`;

const MISSING_DESC = `---
name: only-name
---

body
`;

const UNTERMINATED = `---
name: bad
description: never closes

body without closing fence
`;

describe('discoverSkillFiles', () => {
  it('finds a single SKILL.md at depth 0', async () => {
    const root = join(workDir, 'skills');
    await writeSkill(root, 'hello', SIMPLE_SKILL);

    const result = await discoverSkillFiles([root]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe(join(root, 'SKILL.md'));
    expect(result.files[0]?.depth).toBe(0);
  });

  it('walks recursively and finds SKILL.md at multiple depths', async () => {
    const root = join(workDir, 'skills');
    await writeSkill(join(root, 'a'), 'A', SIMPLE_SKILL);
    await writeSkill(join(root, 'b', 'nested'), 'B', SIMPLE_SKILL);
    await writeSkill(join(root, 'b', 'nested', 'deep'), 'D', SIMPLE_SKILL);

    const result = await discoverSkillFiles([root], { maxDepth: 5 });
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toHaveLength(3);
    expect(paths.some((p) => p.endsWith(`${sep}a${sep}SKILL.md`))).toBe(true);
    expect(paths.some((p) => p.endsWith(`${sep}b${sep}nested${sep}SKILL.md`))).toBe(true);
    expect(
      paths.some((p) => p.endsWith(`${sep}b${sep}nested${sep}deep${sep}SKILL.md`))
    ).toBe(true);
  });

  it('skips node_modules and .git by default', async () => {
    const root = join(workDir, 'skills');
    await writeSkill(join(root, 'real'), 'Real', SIMPLE_SKILL);
    await writeSkill(join(root, 'node_modules', 'evil'), 'Evil', SIMPLE_SKILL);
    await writeSkill(join(root, '.git', 'hook'), 'Hook', SIMPLE_SKILL);

    const result = await discoverSkillFiles([root]);
    const paths = result.files.map((f) => f.path);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain(`${sep}real${sep}SKILL.md`);
  });

  it('respects maxDepth and refuses to recurse past it', async () => {
    const root = join(workDir, 'skills');
    // depth 1
    await writeSkill(join(root, 'a'), 'A', SIMPLE_SKILL);
    // depth 3
    await writeSkill(join(root, 'a', 'b', 'c'), 'Deep', SIMPLE_SKILL);

    const result = await discoverSkillFiles([root], { maxDepth: 1 });
    const paths = result.files.map((f) => f.path);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain(`${sep}a${sep}SKILL.md`);
  });

  it('skips hidden files and directories', async () => {
    const root = join(workDir, 'skills');
    await writeSkill(join(root, 'visible'), 'V', SIMPLE_SKILL);
    await writeSkill(join(root, '.hidden'), 'H', SIMPLE_SKILL);

    const result = await discoverSkillFiles([root]);
    const paths = result.files.map((f) => f.path);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain(`${sep}visible${sep}SKILL.md`);
  });

  it('records missing roots without throwing', async () => {
    const existing = join(workDir, 'exists');
    await writeSkill(existing, 'X', SIMPLE_SKILL);

    const result = await discoverSkillFiles([
      existing,
      join(workDir, 'does-not-exist'),
    ]);
    expect(result.missingRoots).toContain(join(workDir, 'does-not-exist'));
    expect(result.files).toHaveLength(1);
  });

  it('does not follow symlinks pointing outside the root', async () => {
    if (platform === 'win32') {
      // Symlink creation needs elevated perms on Windows; skip.
      return;
    }
    const root = join(workDir, 'skills');
    const outside = join(workDir, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'SKILL.md'), SIMPLE_SKILL, 'utf-8');

    await mkdir(root, { recursive: true });
    await symlink(outside, join(root, 'link'), 'dir');

    const result = await discoverSkillFiles([root]);
    const paths = result.files.map((f) => f.path);
    // readdir with withFileTypes returns symlinks as Dirent.isSymbolicLink(),
    // and we only recurse into isDirectory(), so the linked dir must be skipped.
    expect(paths.find((p) => p.includes('outside'))).toBeUndefined();
  });
});

describe('parseFrontmatter', () => {
  it('parses required and optional fields', () => {
    const result = parseFrontmatter(SIMPLE_SKILL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frontmatter.name).toBe('Hello World');
    expect(result.frontmatter.description).toBe('Says hello.');
    expect(result.frontmatter.whenToUse).toEqual(['greeting', 'casual']);
    expect(result.frontmatter.tools).toEqual(['Bash', 'Read']);
  });

  it('returns ok:false when frontmatter is missing', () => {
    const result = parseFrontmatter(NO_FRONTMATTER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/opening/i);
  });

  it('returns ok:false when name is missing', () => {
    const result = parseFrontmatter(MISSING_NAME);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/name/);
  });

  it('returns ok:false when description is missing', () => {
    const result = parseFrontmatter(MISSING_DESC);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/description/);
  });

  it('returns ok:false on unterminated frontmatter', () => {
    const result = parseFrontmatter(UNTERMINATED);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/unterminated/i);
  });

  it('preserves unknown frontmatter fields in .extra', () => {
    const body = `---
name: X
description: Y
author: someone
version: "1.2"
---
body
`;
    const result = parseFrontmatter(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frontmatter.extra).toEqual({ author: 'someone', version: '1.2' });
  });

  it('strips surrounding quotes from values', () => {
    const body = `---
name: "Quoted Name"
description: 'Quoted Desc'
---
body
`;
    const result = parseFrontmatter(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frontmatter.name).toBe('Quoted Name');
    expect(result.frontmatter.description).toBe('Quoted Desc');
  });

  it('stripFrontmatter returns the body without the --- fences', () => {
    const body = stripFrontmatter(SIMPLE_SKILL);
    expect(body.startsWith('# Hello World')).toBe(true);
    expect(body.includes('---')).toBe(false);
  });

  it('stripFrontmatter returns the original text if no fence', () => {
    const raw = '# no fence\njust text\n';
    expect(stripFrontmatter(raw)).toBe('# no fence\njust text');
  });
});

describe('mergeMountedSkills', () => {
  function mkSkill(id: string, source: 'project' | 'user' | 'external'): import('../../services/skill-mount/types.js').MountedSkill {
    return {
      id,
      name: id,
      source,
      originPath: `/fake/${source}/${id}`,
      content: '',
      frontmatter: {
        name: id,
        description: 'd',
        extra: {},
      },
      enabled: true,
    };
  }

  it('keeps the higher-priority skill and warns on conflict', () => {
    const merged = mergeMountedSkills([
      mkSkill('shared', 'external'),
      mkSkill('shared', 'user'),
      mkSkill('shared', 'project'),
    ]);
    expect(merged.skills).toHaveLength(1);
    expect(merged.skills[0]?.source).toBe('project');
    expect(merged.warnings).toHaveLength(2);
    expect(merged.warnings.every((w) => w.id === 'shared')).toBe(true);
  });

  it('does not throw when there are no conflicts', () => {
    const merged = mergeMountedSkills([
      mkSkill('a', 'project'),
      mkSkill('b', 'user'),
      mkSkill('c', 'external'),
    ]);
    expect(merged.skills).toHaveLength(3);
    expect(merged.warnings).toHaveLength(0);
  });

  it('with overrideOnConflict:false, disambiguates colliding ids', () => {
    const merged = mergeMountedSkills(
      [
        mkSkill('dup', 'user'),
        mkSkill('dup', 'external'),
      ],
      { overrideOnConflict: false }
    );
    expect(merged.skills).toHaveLength(2);
    const ids = merged.skills.map((s) => s.id).sort();
    expect(ids).toEqual(['dup', 'dup#2']);
  });

  it('normalizeId lowercases and replaces non-alphanumerics', () => {
    expect(normalizeId('Hello World!!')).toBe('hello-world');
    expect(normalizeId('  multi   word  ')).toBe('multi-word');
    expect(normalizeId('___')).toBe('');
    expect(normalizeId('foo_bar-baz')).toBe('foo-bar-baz');
  });
});

describe('loadExternalSkills (end-to-end)', () => {
  it('discovers + parses + merges across multiple roots', async () => {
    const projectRoot = join(workDir, '.paude', 'skills');
    const externalRoot = join(workDir, 'external', 'skills');

    await writeSkill(
      join(projectRoot, 'review'),
      'review',
      `---
name: code-review
description: Run a code review pass.
when_to_use: review, audit
---
# Review

Body A
`
    );
    await writeSkill(
      join(externalRoot, 'explain'),
      'explain',
      `---
name: explain
description: Explain a snippet.
tools: Read
---
# Explain

Body B
`
    );

    const config = makeConfig([
      { root: projectRoot, kind: 'project' },
      { root: externalRoot, kind: 'external' },
    ]);

    const result = await loadExternalSkills(config);
    expect(result.skills).toHaveLength(2);
    const ids = result.skills.map((s) => s.id).sort();
    expect(ids).toEqual(['code-review', 'explain']);

    const review = result.skills.find((s) => s.id === 'code-review');
    expect(review?.source).toBe('project');
    expect(review?.content).toContain('Body A');
  });

  it('honors project > user > external priority', async () => {
    const projectRoot = join(workDir, '.claude', 'skills');
    const userRoot = join(workDir, 'user', '.paude', 'skills');
    const externalRoot = join(workDir, 'ecc', 'skills');

    const shared = `---
name: shared
description: shared desc
---
body
`;

    await writeSkill(join(externalRoot, 'shared'), 'shared', shared);
    await writeSkill(join(userRoot, 'shared'), 'shared', shared);
    await writeSkill(join(projectRoot, 'shared'), 'shared', shared);

    const config = makeConfig([
      { root: externalRoot, kind: 'external' },
      { root: userRoot, kind: 'user' },
      { root: projectRoot, kind: 'project' },
    ]);

    const result = await loadExternalSkills(config);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.source).toBe('project');
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('skips files with malformed frontmatter and reports parseErrors', async () => {
    const root = join(workDir, 'skills');
    await writeSkill(join(root, 'good'), 'good', SIMPLE_SKILL);
    await writeSkill(join(root, 'bad'), 'bad', MISSING_NAME);

    const config = makeConfig([{ root, kind: 'project' }]);
    const result = await loadExternalSkills(config);

    const ids = result.skills.map((s) => s.id);
    expect(ids).toContain('hello-world');
    expect(ids).not.toContain('bad');
    expect(result.parseErrors.length).toBeGreaterThanOrEqual(1);
    expect(result.parseErrors.some((e) => e.path.endsWith('bad/SKILL.md'))).toBe(true);
  });

  it('handles special characters in names and descriptions', async () => {
    const root = join(workDir, 'skills');
    const tricky = `---
name: 中文-スキル ✨
description: "Quotes 'inside' and: colons: ok"
when_to_use: a, b, c
---
body with émojis 🚀
`;
    await writeSkill(join(root, 'tricky'), 'tricky', tricky);

    const config = makeConfig([{ root, kind: 'project' }]);
    const result = await loadExternalSkills(config);
    expect(result.skills).toHaveLength(1);
    const skill = result.skills[0];
    expect(skill?.name).toContain('中文');
    expect(skill?.frontmatter.description).toContain("Quotes 'inside'");
    expect(skill?.frontmatter.whenToUse).toEqual(['a', 'b', 'c']);
    expect(skill?.content).toContain('🚀');
  });

  it('returns zero skills when every root is missing', async () => {
    const config = makeConfig([
      { root: join(workDir, 'nope-1'), kind: 'project' },
      { root: join(workDir, 'nope-2'), kind: 'user' },
    ]);
    const result = await loadExternalSkills(config);
    expect(result.skills).toHaveLength(0);
    expect(result.parseErrors).toHaveLength(0);
    // We don't expose missingRoots on the public result, but we do not crash.
  });

  it('defaultRoots produces the documented set of paths', () => {
    const roots = defaultRoots('/tmp/cwd', '/tmp/home');
    expect(roots).toHaveLength(4);
    expect(roots.map((r) => r.kind)).toEqual([
      'project',
      'project',
      'user',
      'external',
    ]);
    expect(roots[3]?.root).toContain('everything-claude-code');
  });
});
