# Skill Mount

The skill mount layer lets PaCode discover, parse, and merge skills from
arbitrary directories on disk. The primary use case is splicing the
[`everything-claude-code`](https://github.com/NikiforovAll/everything-claude-code)
`skills/` directory into PaCode without copying files.

This is a **discovery + parsing** layer. It does not replace
`src/skills/loader.ts` — see [Relationship with `src/skills/loader.ts`](#relationship-with-srcskillsloaderts)
below for the integration boundary.

---

## Public API

```ts
import {
  loadExternalSkills,
  discoverSkillFiles,
  parseFrontmatter,
  stripFrontmatter,
  mergeMountedSkills,
  normalizeId,
  defaultRoots,
} from './services/skill-mount/index.js';
```

### `loadExternalSkills(config, options?)`

Walk every root in `config.roots`, parse every `SKILL.md` found, and return a
priority-resolved list of `MountedSkill` records.

```ts
interface SkillMountConfig {
  roots: SkillSource[];           // priority order (highest first)
  maxDepth?: number;              // default 5
  filenames?: string[];           // default ['SKILL.md']
  skipDirs?: string[];            // default ['node_modules', '.git']
}

interface SkillSource {
  root: string;                   // absolute path
  kind: 'project' | 'user' | 'external';
  label?: string;
}

interface LoadExternalSkillsResult {
  skills: MountedSkill[];
  warnings: MountWarning[];       // merge conflicts
  parseErrors: { path: string; reason: string }[];
}
```

### `MountedSkill`

```ts
interface MountedSkill {
  id: string;                     // lowercased, hyphenated name
  name: string;                   // display name from frontmatter
  source: 'project' | 'user' | 'external';
  originPath: string;             // absolute path to SKILL.md
  content: string;                // markdown body (frontmatter stripped)
  frontmatter: SkillFrontmatter;
  enabled: boolean;
}
```

### Helpers

- `discoverSkillFiles(roots, options)` — pure filesystem walk, no parsing.
- `parseFrontmatter(raw)` — `{ ok: true, frontmatter } | { ok: false, reason }`.
- `stripFrontmatter(raw)` — returns the body after the `---` fence.
- `mergeMountedSkills(candidates, options?)` — combines candidates by priority.
- `normalizeId(name)` — converts a name to a stable lowercased id.
- `defaultRoots(cwd, home)` — returns the documented default root set.

---

## Relationship with `src/skills/loader.ts`

`src/skills/loader.ts` is the canonical PaCode skill loader today. It walks
`<cwd>/.claude/skills/`, parses each `*/SKILL.md`, and exposes the results via
`get(name)` / `match(query)` / `list()`.

`services/skill-mount/` is **not** a replacement. It is a parallel pipeline:

| Concern                              | `src/skills/loader.ts` | `services/skill-mount/` |
|--------------------------------------|------------------------|-------------------------|
| Single hard-coded source             | Yes                    | No                      |
| Arbitrary external roots             | No                     | Yes                     |
| YAML frontmatter parsing             | Partial (section-based)| Explicit                |
| Multi-source merge with priorities   | No                     | Yes                     |
| Recursion depth cap                  | 1                      | Configurable (default 5)|
| Symlink protection                   | N/A                    | Yes (no follow)         |

The intent for **Stage 2 integration** is a thin adapter that:

1. Calls `loadExternalSkills(...)` to produce `MountedSkill[]`.
2. Converts each `MountedSkill` into the existing `Skill` shape (or a
   superset of it) and feeds it into the existing `SkillsLoader` (or a new
   `SkillsRegistry` that holds both legacy-loaded and mount-loaded skills).
3. Logs `warnings` (merge conflicts) and `parseErrors` once at startup.

This service owns **nothing** about how skills are used by the agent — that
stays in `src/skills/loader.ts` and `src/agent/*`.

---

## everything-claude-code Integration

### One-time setup

```bash
# 1. Clone everything-claude-code into your home directory
git clone https://github.com/NikiforovAll/everything-claude-code.git \
    ~/everything-claude-code

# 2. (Optional) Verify the skill layout
ls ~/everything-claude-code/skills | head
# expect: code-review  tdd  refactor  ...
```

### Mount it from PaCode

```ts
import { loadExternalSkills } from 'pacode/services/skill-mount/index.js';
import { homedir } from 'node:os';

const home = homedir();
const result = await loadExternalSkills({
  roots: [
    { root: `${process.cwd()}/.paude/skills`, kind: 'project' },
    { root: `${process.cwd()}/.claude/skills`, kind: 'project' },
    { root: `${home}/.paude/skills`,           kind: 'user' },
    { root: `${home}/everything-claude-code/skills`, kind: 'external' },
  ],
});

for (const w of result.warnings) {
  console.warn(
    `[skill-mount] override: ${w.id} from ${w.overriddenSource} ` +
    `(${w.overriddenPath}) lost to ${w.winningSource} (${w.winningPath})`
  );
}
for (const e of result.parseErrors) {
  console.warn(`[skill-mount] parse failed: ${e.path} -> ${e.reason}`);
}

console.log(`Loaded ${result.skills.length} skills`);
```

That is the entire integration. No npm install, no copy step, no glob
dependency.

---

## Known Limitations

The frontmatter parser is deliberately minimal. It supports what
`everything-claude-code/skills/*/SKILL.md` actually contains, but **not** the
full YAML 1.2 grammar.

| Feature                                  | Supported? | Notes |
|------------------------------------------|------------|-------|
| `key: value` scalars                     | Yes        | Trimmed; quotes stripped. |
| `when_to_use: a, b, c` lists             | Yes        | Comma-separated only. |
| `tools: a, b` lists                      | Yes        | Comma-separated only. |
| Unknown fields preserved under `.extra`  | Yes        | Always strings. |
| Nested mappings (`a:\n  b: c`)           | No         | Treated as comments. |
| Block scalars (`\|` / `>`)               | No         | |
| Sequences (`- item`)                     | No         | Use comma-separated scalars. |
| YAML anchors (`&` / `*`)                 | No         | |
| Multi-document (`---` followed by `---`) | No         | First `---` closes the block. |

If you hit a `parse.ts` limitation, the failure is **reported, not swallowed**:
`parseErrors` carries the file path and a human-readable reason.

### Other limitations

- Symlinks are **not followed** during the walk — protects against
  accidental traversal of large dependency trees.
- Hidden files and dot-directories are skipped by default. Pass
  `includeHidden: true` to `discoverSkillFiles` if you really need them.
- `maxDepth` is inclusive of the root. Default `5` matches the deepest
  realistic `skills/<category>/<sub>/SKILL.md` layout.
- A `SKILL.md` sitting **directly at the root** is included; there is no
  requirement that it live one level deep.

---

## Module Map

```
services/skill-mount/
├── index.ts    Public API entrypoint — loadExternalSkills, re-exports
├── discover.ts Filesystem walker (no glob dep, depth-capped)
├── parse.ts    Minimal YAML frontmatter parser
├── merge.ts    Priority-based merge with warning reporting
├── types.ts    Public types: SkillSource, MountedSkill, etc.
└── README.md   You are here.
```

Every module is independently testable; see `test/services/skill-mount.test.ts`.
