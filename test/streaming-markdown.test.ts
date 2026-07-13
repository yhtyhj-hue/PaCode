/**
 * Streaming markdown writer tests
 */

import { describe, it, expect } from 'vitest';
import { StreamingMarkdownWriter, summarizeToolAction } from '../src/cli/streaming-markdown.js';

describe('StreamingMarkdownWriter', () => {
  it('buffers incomplete bold markers', () => {
    const writer = new StreamingMarkdownWriter();
    expect(writer.append('Hello **bo')).toBe('Hello ');
    const rest = writer.append('ld** world');
    expect(rest.length).toBeGreaterThan(0);
    expect(writer.flush()).toBe('');
  });

  it('formats complete inline code immediately', () => {
    const writer = new StreamingMarkdownWriter();
    const out = writer.append('Use `npm test`');
    expect(out).toContain('npm test');
  });

  it('flush emits held-back suffix', () => {
    const writer = new StreamingMarkdownWriter();
    writer.append('partial `code');
    const flushed = writer.flush();
    expect(flushed).toContain('code');
  });

  it('reset clears buffer', () => {
    const writer = new StreamingMarkdownWriter();
    writer.append('**incomplete');
    writer.reset();
    expect(writer.append('fresh')).toContain('fresh');
  });
});

describe('summarizeToolAction', () => {
  it('summarizes Bash command', () => {
    expect(
      summarizeToolAction({ name: 'Bash', input: { command: 'ls -la' } })
    ).toBe('ls -la');
  });

  it('summarizes Read path', () => {
    expect(
      summarizeToolAction({ name: 'Read', input: { path: 'src/index.ts' } })
    ).toBe('src/index.ts');
  });
});
