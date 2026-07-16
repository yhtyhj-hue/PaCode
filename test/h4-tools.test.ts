/**
 * H4 tool fidelity — Grep flags, Read offset/limit, Bash truncation notice
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, statSync } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerGrepTool } from '../src/tools/grep.js';
import { registerReadTool } from '../src/tools/read.js';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'pacode-h4-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('H4 Grep flags', () => {
  it('passes -i to ripgrep for ignore_case', async () => {
    await writeFile(join(workDir, 'a.txt'), 'TODO Fix\nfix bug\nother\n');
    const r = new ToolRegistry();
    registerGrepTool(r);
    const result = await r.execute(
      { id: '1', name: 'Grep', input: { pattern: 'todo', path: workDir, ignore_case: true } },
      { workingDirectory: workDir, sessionState: {} as never, hooks: {} as never }
    );
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    // Case-insensitive: rg should match 'TODO' (uppercase) when pattern is lowercase
    expect(text.toLowerCase()).toContain('todo');
  });

  it('respects --glob include filter', async () => {
    await writeFile(join(workDir, 'a.ts'), 'needle\n');
    await writeFile(join(workDir, 'b.md'), 'needle\n');
    const r = new ToolRegistry();
    registerGrepTool(r);
    const result = await r.execute(
      { id: '1', name: 'Grep', input: { pattern: 'needle', path: workDir, include: '*.ts' } },
      { workingDirectory: workDir, sessionState: {} as never, hooks: {} as never }
    );
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('a.ts');
    expect(text).not.toContain('b.md');
  });

  it('applies max_results truncation with hint', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `match-${i}`).join('\n');
    await writeFile(join(workDir, 'big.txt'), lines);
    const r = new ToolRegistry();
    registerGrepTool(r);
    const result = await r.execute(
      { id: '1', name: 'Grep', input: { pattern: 'match', path: workDir, max_results: 5 } },
      { workingDirectory: workDir, sessionState: {} as never, hooks: {} as never }
    );
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('truncated');
    expect(text).toContain('match-0');
    expect(text).toContain('match-4');
    expect(text).not.toContain('match-5');
  });
});

describe('H4 Read offset/limit', () => {
  beforeEach(async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `L${i + 1}`).join('\n');
    await writeFile(join(workDir, 'big.txt'), lines);
  });

  it('reads from offset 50 with limit 5', async () => {
    const r = new ToolRegistry();
    registerReadTool(r);
    const result = await r.execute(
      { id: '1', name: 'Read', input: { path: 'big.txt', offset: 50, limit: 5 } },
      { workingDirectory: workDir, sessionState: {} as never, hooks: {} as never }
    );
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('L50');
    expect(text).toContain('L54');
    expect(text).toContain('showing lines 50-54');
  });

  it('shows partial note when offset>1', async () => {
    const r = new ToolRegistry();
    registerReadTool(r);
    const result = await r.execute(
      { id: '1', name: 'Read', input: { path: 'big.txt', offset: 50, limit: 3 } },
      { workingDirectory: workDir, sessionState: {} as never, hooks: {} as never }
    );
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toMatch(/lines \d+-\d+ of \d+/);
  });

  it('returns friendly error for missing file', async () => {
    const r = new ToolRegistry();
    registerReadTool(r);
    const result = await r.execute(
      { id: '1', name: 'Read', input: { path: 'does-not-exist.txt' } },
      { workingDirectory: workDir, sessionState: {} as never, hooks: {} as never }
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('File not found');
  });

  it('rejects directories with helpful message', async () => {
    await mkdir(join(workDir, 'sub'));
    const r = new ToolRegistry();
    registerReadTool(r);
    const result = await r.execute(
      { id: '1', name: 'Read', input: { path: 'sub' } },
      { workingDirectory: workDir, sessionState: {} as never, hooks: {} as never }
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('directory');
  });

  it('rejects files larger than 200KB with offset hint', async () => {
    // Create a >200KB file
    const big = Buffer.alloc(210 * 1024, 'a');
    await writeFile(join(workDir, 'huge.txt'), big);
    const r = new ToolRegistry();
    registerReadTool(r);
    const result = await r.execute(
      { id: '1', name: 'Read', input: { path: 'huge.txt' } },
      { workingDirectory: workDir, sessionState: {} as never, hooks: {} as never }
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('large');
    expect(text).toContain('offset');
  });
});

describe('H4 Bash truncation notice', () => {
  it('appends truncation hint when output is truncated', async () => {
    const { registerBashTool } = await import('../src/tools/bash.js');
    const reg = new ToolRegistry();
    registerBashTool(reg);
    // seq is in bash-secure's READONLY list; 600 lines exceeds
    // bash.ts maxOutputLines=500, so truncation must trigger.
    const result = await reg.execute(
      {
        id: '1',
        name: 'Bash',
        input: { command: 'seq 1 600' },
      },
      { workingDirectory: workDir, sessionState: {} as never, hooks: {} as never }
    );
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(result.isError).toBeFalsy();
    expect(text).toContain('truncated by PaCode');
    expect(text).toContain('narrower command');
  });
});