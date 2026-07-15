/**
 * Edit tool uniqueness + replaceAll
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerEditTool, countOccurrences } from '../src/tools/edit.js';

describe('countOccurrences', () => {
  it('counts non-overlapping matches', () => {
    expect(countOccurrences('aaa', 'aa')).toBe(1);
    expect(countOccurrences('ababab', 'ab')).toBe(3);
    expect(countOccurrences('hello', 'x')).toBe(0);
  });
});

describe('Edit tool', () => {
  let dir: string;
  let registry: ToolRegistry;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pacode-edit-'));
    registry = new ToolRegistry();
    registerEditTool(registry);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('replaces a unique occurrence', async () => {
    const path = join(dir, 'a.ts');
    writeFileSync(path, 'const x = 1;\nconst y = 2;\n');
    const tool = registry.get('Edit')!;
    const result = await tool.execute(
      { path, oldText: 'const x = 1;', newText: 'const x = 10;' },
      { workingDirectory: dir, sessionState: {} as never, hooks: {} as never }
    );
    expect(result.isError).toBeFalsy();
    expect(readFileSync(path, 'utf-8')).toBe('const x = 10;\nconst y = 2;\n');
  });

  it('rejects ambiguous oldText unless replaceAll', async () => {
    const path = join(dir, 'b.ts');
    writeFileSync(path, 'foo\nfoo\n');
    const tool = registry.get('Edit')!;
    const result = await tool.execute(
      { path, oldText: 'foo', newText: 'bar' },
      { workingDirectory: dir, sessionState: {} as never, hooks: {} as never }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(String((result.content[0] as { text: string }).text)).toContain('2 occurrences');

    const all = await tool.execute(
      { path, oldText: 'foo', newText: 'bar', replaceAll: true },
      { workingDirectory: dir, sessionState: {} as never, hooks: {} as never }
    );
    expect(all.isError).toBeFalsy();
    expect(readFileSync(path, 'utf-8')).toBe('bar\nbar\n');
  });
});
