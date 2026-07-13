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
    expect(result.content[0]?.text).toContain('package.json');
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
    expect(result.content[0]?.text).toMatch(/MemoryStore|No matches/);
  });

  it('uses DEFAULT permission mode', () => {
    const registry = new ToolRegistry();
    registerGrepTool(registry);
    expect(registry.get('Grep')?.permissionMode).toBe(PermissionMode.DEFAULT);
  });
});
