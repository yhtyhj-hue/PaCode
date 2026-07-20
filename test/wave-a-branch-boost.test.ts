/**
 * 抬 branches 覆盖：易测错误/边界路径（Wave A coverage）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerWriteTool } from '../src/tools/write.js';
import { registerGlobTool } from '../src/tools/glob.js';
import { htmlToText } from '../src/services/web-fetch/extract.js';
import {
  applyPostToolUseDecision,
  parsePostToolUseDecision,
  parseStopHookDecision,
} from '../src/hooks/hook-decision.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('wave-a branch boost', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cov-'));
  });

  it('Write rejects path outside workspace', async () => {
    const reg = new ToolRegistry();
    registerWriteTool(reg);
    const r = await reg.get('Write')!.execute(
      { path: '../escape.txt', content: 'x' },
      { workingDirectory: dir, sessionState: { sessionId: 's', mode: PermissionMode.BYPASS } as never }
    );
    expect(r.isError).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('Glob handles empty pattern result shape', async () => {
    const reg = new ToolRegistry();
    registerGlobTool(reg);
    const r = await reg.get('Glob')!.execute(
      { pattern: 'no-such-*.zzz' },
      { workingDirectory: dir, sessionState: { sessionId: 's', mode: PermissionMode.BYPASS } as never }
    );
    expect(r.isError).not.toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('htmlToText empty-label anchor falls back to href', () => {
    expect(htmlToText('<a href="https://ex.com/y"></a>')).toContain('[https://ex.com/y](https://ex.com/y)');
    expect(htmlToText('<a href="https://ex.com/z"><em>Z</em></a>')).toContain('[Z](https://ex.com/z)');
  });

  it('hook-decision covers allow / modify / invalid JSON / stop continue', () => {
    const base = { content: [{ type: 'text' as const, text: 'orig' }] };
    expect(applyPostToolUseDecision(base, 'not-json', 0, 'h')).toEqual(base);
    expect(parsePostToolUseDecision('{"decision":"allow"}').kind).toBe('allow');
    expect(parsePostToolUseDecision('{').kind).toBe('allow');
    expect(parsePostToolUseDecision('{"decision":"modify"}').kind).toBe('allow'); // no content array
    expect(parsePostToolUseDecision('[]').kind).toBe('allow');
    expect(parsePostToolUseDecision('42').kind).toBe('allow');
    const mod = applyPostToolUseDecision(
      base,
      '{"decision":"modify","content":[{"type":"text","text":"m"}],"isError":true}',
      0,
      'h'
    );
    expect(mod.isError).toBe(true);
    expect(parseStopHookDecision('{"decision":"continue"}').kind).toBe('continue');
    expect(parseStopHookDecision('{"decision":"STOP","reason":"x"}').kind).toBe('stop');
    expect(parseStopHookDecision('{bad').kind).toBe('continue');
  });
});
