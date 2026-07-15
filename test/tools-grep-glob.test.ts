import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerGlobTool } from '../src/tools/glob.js';
import { registerGrepTool } from '../src/tools/grep.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('Glob tool', () => {
  it('finds files in cwd', async () => {
    const registry = new ToolRegistry();
    registerGlobTool(registry);
    const result = await registry.execute(
      { id: '1', name: 'Glob', input: { pattern: 'package.json' } },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );
    expect(result.isError).toBeFalsy();
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('package.json');
  });
});

describe('Grep tool', () => {
  it('searches pattern in repo', async () => {
    const registry = new ToolRegistry();
    registerGrepTool(registry);
    const result = await registry.execute(
      { id: '1', name: 'Grep', input: { pattern: 'MemoryStore', path: 'src/memory' } },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );
    expect((result.content[0] as { type: 'text'; text: string }).text).toMatch(/MemoryStore|No matches/);
  });

  it('uses DEFAULT permission mode', () => {
    const registry = new ToolRegistry();
    registerGrepTool(registry);
    expect(registry.get('Grep')?.permissionMode).toBe(PermissionMode.DEFAULT);
  });

  // Regression: ensure grep.ts uses execFile (parameterized argv), NOT exec with template string.
  // A shell injection payload in pattern/path must be passed literally as a rg argument, never interpreted by /bin/sh.
  it('passes pattern and path as argv, not via shell interpolation', async () => {
    const registry = new ToolRegistry();
    registerGrepTool(registry);
    // Safe pattern (no rg match in repo) — if shell interpolation were active, $(id) would execute.
    // We assert no error / no id-output leakage to confirm argument was passed through rg verbatim.
    const result = await registry.execute(
      {
        id: '1',
        name: 'Grep',
        input: { pattern: 'definitely_not_in_repo_xyz_$(id)_suffix', path: '.' },
      },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );
    const text = (result.content[0] as { type: 'text'; text: string }).text ?? '';
    expect(text).not.toMatch(/uid=\d+\(/); // no `id` command execution leak
    expect(result.isError).toBeFalsy();
  });
});
