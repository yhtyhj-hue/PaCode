/**
 * /init — 创建项目 CLAUDE.md（确定性模板）
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEMPLATE = `# CLAUDE.md

Project-specific instructions for PaCode/Claude Code.

## Project Overview

[Briefly describe your project here]

## Architecture

[Describe the high-level architecture]

## Key Files

- [\`src/\`](src/) - Source code
- [\`docs/\`](docs/) - Documentation
- [\`tests/\`](tests/) - Test files

## Development Workflow

1. Read the relevant code first
2. Make focused changes
3. Run tests before committing
4. Update documentation if needed

## Conventions

- Use TypeScript for all new code
- Follow existing code style
- Write tests for new features
- Update CLAUDE.md when patterns change
`;

export type InitClaudeMdResult =
  | { ok: true; path: string; lines: string[] }
  | { ok: false; lines: string[] };

export function initClaudeMd(cwd = process.cwd()): InitClaudeMdResult {
  const path = join(cwd, 'CLAUDE.md');
  if (existsSync(path)) {
    return { ok: false, lines: [`CLAUDE.md already exists at ${path}`] };
  }
  try {
    writeFileSync(path, TEMPLATE, 'utf-8');
    return { ok: true, path, lines: [`Created CLAUDE.md at ${path}`] };
  } catch (e) {
    return {
      ok: false,
      lines: [`Failed to create CLAUDE.md: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}
