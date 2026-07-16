/**
 * I1: auto-extract auditable memory
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFacts, recordAutoMemory } from '../src/memory/auto-extract.js';
import type { Message } from '../src/pkg/types.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'pacode-i1-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeMessage(role: 'user' | 'assistant', content: string, ts = Date.now()): Message {
  return { role, content, timestamp: ts };
}

describe('I1 extractFacts', () => {
  it('captures "X 是 Y" Chinese definitional statements', () => {
    const facts = extractFacts([
      makeMessage('user', 'PaCode 是一个 AI 编程助手框架。'),
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.pattern).toBe('is-def-zh');
    expect(facts[0]?.fact).toContain('PaCode');
  });

  it('captures "项目用 X" pattern', () => {
    const facts = extractFacts([
      makeMessage('assistant', '项目用 TypeScript 实现的。'),
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.pattern).toBe('project-uses');
  });

  it('captures "set X to Y" English', () => {
    const facts = extractFacts([
      makeMessage('user', 'set log to debug.'),
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.pattern).toBe('set-config');
  });

  it('captures "decided to X"', () => {
    const facts = extractFacts([
      makeMessage('user', 'decided to use JSONL format.'),
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.pattern).toBe('decision');
  });

  it('skips questions', () => {
    const facts = extractFacts([makeMessage('user', '这是好的吗？')]);
    expect(facts).toHaveLength(0);
  });

  it('skips code-fenced lines', () => {
    const facts = extractFacts([makeMessage('user', '```ts\nconst x = 1;\n```')]);
    expect(facts).toHaveLength(0);
  });

  it('skips lines that are too short or too long', () => {
    const short = extractFacts([makeMessage('user', 'no')]);
    expect(short).toHaveLength(0);
    const long = extractFacts([makeMessage('user', 'a'.repeat(300) + ' 是 b。')]);
    expect(long).toHaveLength(0);
  });

  it('numbers facts sequentially within the day', () => {
    const facts = extractFacts([
      makeMessage('user', 'PaCode 是 AI 助手。'),
      makeMessage('user', '项目用 TypeScript 实现的。'),
    ]);
    expect(facts).toHaveLength(2);
    expect(facts[0]?.id).toBe('0001');
    expect(facts[1]?.id).toBe('0002');
  });

  it('preserves messageIndex and role for audit', () => {
    const facts = extractFacts([
      makeMessage('user', 'X is a test.'), // not a match
      makeMessage('user', 'set mode to auto.'),
      makeMessage('assistant', 'decided to add memory.'),
    ]);
    expect(facts).toHaveLength(2);
    expect(facts[0]?.messageIndex).toBe(1);
    expect(facts[0]?.role).toBe('user');
    expect(facts[1]?.messageIndex).toBe(2);
    expect(facts[1]?.role).toBe('assistant');
  });

  it('dryRun returns facts without writing', async () => {
    const baseDir = join(workDir, 'memory');
    const facts = await recordAutoMemory(
      [makeMessage('user', 'set mode to auto.')],
      { baseDir, dryRun: true }
    );
    expect(facts).toHaveLength(1);
    expect(existsSync(baseDir)).toBe(false);
  });
});

describe('I1 recordAutoMemory persistence', () => {
  it('writes one JSONL line per fact to <baseDir>/<date>.jsonl', async () => {
    const baseDir = join(workDir, 'memory');
    const facts = await recordAutoMemory(
      [
        makeMessage('user', 'PaCode 是一个 AI 助手。'),
        makeMessage('user', '项目用 TypeScript 实现的。'),
      ],
      { baseDir }
    );
    expect(facts).toHaveLength(2);

    const day = new Date().toISOString().slice(0, 10);
    const filePath = join(baseDir, `${day}.jsonl`);
    expect(existsSync(filePath)).toBe(true);

    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed0 = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed0.pattern).toBe('is-def-zh');
    expect(parsed0.role).toBe('user');
  });

  it('appends to the same file across calls (idempotent file path)', async () => {
    const baseDir = join(workDir, 'memory');
    await recordAutoMemory(
      [makeMessage('user', 'PaCode 是一个 AI 助手。')],
      { baseDir }
    );
    await recordAutoMemory(
      [makeMessage('user', '项目用 TypeScript 实现的。')],
      { baseDir }
    );
    const day = new Date().toISOString().slice(0, 10);
    const filePath = join(baseDir, `${day}.jsonl`);
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('returns empty array when no facts match (no file written)', async () => {
    const baseDir = join(workDir, 'memory');
    const facts = await recordAutoMemory([makeMessage('user', '随便说点什么。')], {
      baseDir,
    });
    expect(facts).toHaveLength(0);
    expect(existsSync(baseDir)).toBe(false);
  });

  it('creates baseDir recursively if missing', async () => {
    const baseDir = join(workDir, 'deep', 'nested', 'memory');
    const facts = await recordAutoMemory(
      [makeMessage('user', 'set mode to auto.')],
      { baseDir }
    );
    expect(facts).toHaveLength(1);
    expect(existsSync(baseDir)).toBe(true);
  });
});