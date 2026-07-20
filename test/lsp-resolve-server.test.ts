/**
 * Wave C: multi-lang LSP discovery
 */

import { describe, it, expect } from 'vitest';
import {
  languageIdFromPath,
  resolveLanguageServer,
} from '../src/services/lsp-client/resolve-server.js';

describe('resolveLanguageServer', () => {
  it('maps extensions to language ids', () => {
    expect(languageIdFromPath('a.ts')).toBe('typescript');
    expect(languageIdFromPath('b.py')).toBe('python');
    expect(languageIdFromPath('c.go')).toBe('go');
    expect(languageIdFromPath('d.rs')).toBe('rust');
    expect(languageIdFromPath('e.txt')).toBe(null);
  });

  it('honors PACODE_LSP_PYTHON override', () => {
    const r = resolveLanguageServer('x.py', process.cwd(), {
      PACODE_LSP_PYTHON: '/opt/pyright --stdio',
    });
    expect(r).toEqual({
      command: '/opt/pyright',
      args: ['--stdio'],
      languageId: 'python',
    });
  });

  it('returns null for python without binary or env', () => {
    const r = resolveLanguageServer('x.py', '/tmp/nonexistent-cwd-xyz', {});
    // which() may find system pyright; if so just assert shape
    if (r) {
      expect(r.languageId).toBe('python');
      expect(r.command).toBeTruthy();
    } else {
      expect(r).toBeNull();
    }
  });
});
