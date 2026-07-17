/**
 * P0–P2 CC parity fixes: retry 5xx, BashOutput, PermissionRequest,
 * reflection skip, Diagnostics alias, voice, compact L4, MCP websocket
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRetryableError } from '../src/agent/retry.js';
import { runReflection, detectVerifiers } from '../src/agent/reflection.js';
import { summarizeMessageForCollapse } from '../src/context/compaction-utils.js';
import { getBashJobStore, resetBashJobStore } from '../src/services/bash-jobs/index.js';
import { getVoiceStatus, formatVoiceStatus } from '../src/services/voice/index.js';
import { validateMcpServerEntry } from '../src/mcp/validate.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerCoreTools } from '../src/tools/bootstrap.js';
import { HookRegistry } from '../src/hooks/registry.js';
import { HookType, PermissionMode, type SessionState, type ToolCall } from '../src/pkg/types.js';
import { rewindToDetailed } from '../src/services/checkpoint.js';
import { QueryProgressLine } from '../src/cli/query-progress.js';

describe('P0 retry 5xx', () => {
  it('retries 500/502/503 by default', () => {
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 502 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 401 })).toBe(false);
  });
});

describe('P1 Bash background + BashOutput', () => {
  beforeEach(() => resetBashJobStore());
  afterEach(() => resetBashJobStore());

  it('starts background job and polls output', async () => {
    const store = getBashJobStore();
    const started = store.start('printf hello; sleep 0.2; printf world');
    expect('job' in started).toBe(true);
    if (!('job' in started)) return;
    const id = started.job.id;

    await new Promise((r) => setTimeout(r, 400));
    const out = store.readOutput(id);
    expect('status' in out && out.status === 'done').toBe(true);
    if ('stdout' in out) {
      expect(out.stdout).toContain('hello');
      expect(out.stdout).toContain('world');
    }
  });

  it('registers BashOutput and BashStop tools', () => {
    const reg = new ToolRegistry();
    registerCoreTools(reg, { task: { toolRegistry: reg } });
    expect(reg.has('BashOutput')).toBe(true);
    expect(reg.has('BashStop')).toBe(true);
    expect(reg.has('Diagnostics')).toBe(true);
    expect(reg.list()).toHaveLength(31);
  });
});

describe('P1 PermissionRequest hook', () => {
  it('registers and executes PermissionRequest hooks', async () => {
    const hooks = new HookRegistry();
    hooks.register({
      type: HookType.PERMISSION_REQUEST,
      name: 'auto-approve',
      command: ['printf', 'approve'],
    });
    const ctx = {
      sessionState: { sessionId: 's', mode: PermissionMode.DEFAULT } as SessionState,
      currentTool: { name: 'Write', id: '1', input: {} } as ToolCall,
    };
    const matching = hooks.findMatching(HookType.PERMISSION_REQUEST, ctx as never);
    expect(matching).toHaveLength(1);
    const result = await hooks.execute(matching[0]!);
    expect(result.stdout.trim()).toBe('approve');
  });
});

describe('P1 reflection skipNotice', () => {
  it('emits skipNotice when no real test script', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ref-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })
    );
    const v = detectVerifiers(dir);
    expect(v.some((x) => !x.available)).toBe(true);
    const summary = await runReflection(dir);
    expect(summary.skipNotice).toMatch(/Do not claim tests/);
    expect(summary.failureMessage).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('P2 Diagnostics / Voice / Compact / MCP ws / rewind detail', () => {
  it('collapse summary extracts tools and paths', () => {
    const s = summarizeMessageForCollapse({
      role: 'assistant',
      content: 'Used Read on src/agent/engine.ts then Edit failed with error',
      timestamp: 1,
    });
    expect(s).toMatch(/tools=/);
    expect(s).toMatch(/paths=/);
    expect(s).toMatch(/has_error/);
  });

  it('voice status is available when STT unset (not deferred)', () => {
    expect(getVoiceStatus().status).toBe('available');
    expect(formatVoiceStatus()).toMatch(/Voice status: available/);
    expect(formatVoiceStatus()).toMatch(/voice\/v1-stt-pipe/);
  });

  it('accepts websocket MCP urls', () => {
    expect(validateMcpServerEntry({ type: 'websocket', url: 'wss://example.com/mcp' })).toBeNull();
    expect(validateMcpServerEntry({ type: 'websocket', url: 'https://example.com' })).toMatch(
      /ws:\/\//
    );
  });

  it('rewindToDetailed reports not_found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rw-'));
    // non-git → not_git
    const r = rewindToDetailed('nope/0', dir);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_git');
    rmSync(dir, { recursive: true, force: true });
  });

  it('QueryProgressLine tracks tool timeline', () => {
    const p = new QueryProgressLine();
    p.startThinking();
    p.setToolPhase('Read foo.ts');
    p.setToolPhase('Bash npm test');
    expect(p.formatTimelineSummary()).toMatch(/Read foo\.ts → Bash npm test/);
    p.stop();
  });
});

describe('P0 M1/M3 multi-lang policy surface', () => {
  it('requires tools for multi-file deep-read phrasing', async () => {
    const { requiresToolExecution } = await import('../src/agent/tool-intent.js');
    expect(requiresToolExecution('逐行读全部 TypeScript 和 Python 源文件')).toBe(true);
    expect(requiresToolExecution('完整读 multi-file 项目里的每个模块')).toBe(true);
    expect(requiresToolExecution('对 Go 和 Rust 做一次深度质检')).toBe(true);
  });
});
