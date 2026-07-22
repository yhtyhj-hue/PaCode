import { describe, it, expect, beforeEach } from 'vitest';
import { CCSwitchClient } from '../src/pkg/ccswitch/index.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, existsSync } from 'node:fs';

describe('CCSwitchClient - Deep', () => {
  let path: string;
  let c: CCSwitchClient;

  beforeEach(() => {
    path = join(tmpdir(), 'pacode-cctest-' + Date.now() + '-' + Math.random() + '.json');
    c = new CCSwitchClient(path);
  });

  it('starts empty', () => {
    expect(c.list()).toEqual([]);
    expect(c.getActive()).toBeUndefined();
  });

  it('adds provider', () => {
    c.addProvider({ name: 'p1', apiKey: 'k' });
    expect(c.list().length).toBe(1);
  });

  it('updates existing', () => {
    c.addProvider({ name: 'p', apiKey: 'old' });
    c.addProvider({ name: 'p', apiKey: 'new' });
    expect(c.list()[0]?.apiKey).toBe('new');
  });

  it('switches', () => {
    c.addProvider({ name: 'a', apiKey: 'k1' });
    c.addProvider({ name: 'b', apiKey: 'k2' });
    c.switchTo('b');
    expect(c.getActive()?.name).toBe('b');
  });

  it('switch non-existent returns null', () => {
    c.addProvider({ name: 'a', apiKey: 'k' });
    expect(c.switchTo('none')).toBeNull();
  });

  it('marks only one active', () => {
    c.addProvider({ name: 'a', apiKey: 'k1' });
    c.addProvider({ name: 'b', apiKey: 'k2' });
    c.switchTo('b');
    const all = c.list();
    const active = all.filter(p => p.active);
    expect(active.length).toBe(1);
    expect(active[0]?.name).toBe('b');
  });

  it('returns credentials', () => {
    c.addProvider({ name: 'p', apiKey: 'k', baseUrl: 'http://x', model: 'm', active: true });
    const creds = c.getCredentials();
    expect(creds.apiKey).toBe('k');
    expect(creds.baseUrl).toBe('http://x');
  });

  it('switch sets env vars', () => {
    c.addProvider({ name: 'env', apiKey: 'envk', model: 'em' });
    c.switchTo('env');
    expect(process.env['ANTHROPIC_API_KEY']).toBe('envk');
  });

  it('saves to file', () => {
    c.addProvider({ name: 'p', apiKey: 'k' });
    expect(existsSync(path)).toBe(true);
  });

  it('loads from file', () => {
    c.addProvider({ name: 'first', apiKey: 'k1' });
    c.switchTo('first');
    const c2 = new CCSwitchClient(path);
    expect(c2.list().length).toBe(1);
    expect(c2.getActive()?.name).toBe('first');
  });

  it('removes provider', () => {
    c.addProvider({ name: 'a', apiKey: 'k1' });
    c.addProvider({ name: 'b', apiKey: 'k2' });
    c.switchTo('b');
    expect(c.removeProvider('b')).toBe(true);
    expect(c.list().length).toBe(1);
    expect(c.getActive()?.name).toBe('a');
  });

  it('removeProvider returns false for missing', () => {
    expect(c.removeProvider('missing')).toBe(false);
  });

  it('handles corrupted json', () => {
    writeFileSync(path, 'invalid{');
    const c2 = new CCSwitchClient(path);
    expect(c2.list()).toEqual([]);
  });

  it('detects sources without Claude Code', () => {
    const s = c.detectSources();
    expect(s.claudeCode).toBe(false);
    expect(s.ccswitch).toBe(false);
    expect(s).toHaveProperty('pacode');
  });

  it('CC import methods are no-ops', () => {
    expect(c.importFromClaudeCode()).toBe(0);
    expect(c.autoImportFromClaudeCode()).toBeNull();
  });

  it('exposes config path', () => {
    expect(c.getConfigPath()).toBe(path);
  });
});
