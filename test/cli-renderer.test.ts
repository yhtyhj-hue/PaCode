import { describe, it, expect } from 'vitest';
import { Renderer } from '../src/cli/renderer.js';

describe('Renderer', () => {
  const r = new Renderer(20);

  it('renders box with borders', () => {
    const box = r.box('hello');
    expect(box).toContain('┌');
    expect(box).toContain('hello');
    expect(box).toContain('└');
  });

  it('centers and right-aligns text', () => {
    const center = r.box('x', { width: 10, align: 'center' });
    expect(center.split('\n')[1]).toContain('x');
    const right = r.box('y', { width: 10, align: 'right' });
    expect(right.split('\n')[1]?.trimEnd()).toMatch(/y\s*│/);
  });

  it('progressBar shows percentage', () => {
    expect(r.progressBar(5, 10)).toContain('50%');
    expect(r.progressBar(10, 10)).toContain('100%');
  });

  it('formats tool use and messages', () => {
    expect(r.formatToolUse('Read', { path: 'a.ts' })).toContain('Read');
    expect(r.formatError('fail')).toContain('fail');
    expect(r.formatSuccess('ok')).toContain('ok');
    expect(r.formatInfo('note')).toContain('note');
  });

  it('spinner cycles frames', () => {
    expect(r.spinner(0)).not.toBe(r.spinner(1));
  });

  it('setWidth updates layout', () => {
    r.setWidth(30);
    expect(r.box('z', { width: 30 }).includes('─'.repeat(30))).toBe(true);
  });
});
