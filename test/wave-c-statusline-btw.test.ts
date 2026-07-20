/**
 * Wave C: statusline hook + /btw background turn
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveStatuslineCommand, runStatuslineHook } from '../src/cli/statusline.js';
import { formatStatusBar } from '../src/cli/repl-ui.js';
import { PermissionMode } from '../src/pkg/types.js';
import { REPL } from '../src/cli/repl.js';
import { resetTaskStore, getTaskStore } from '../src/services/task-registry/index.js';
import { QueryEngine } from '../src/agent/engine.js';
import { ToolRegistry } from '../src/tools/registry.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
} from './helpers/mock-anthropic.js';
import { stubAssembler, passthroughCompaction } from './helpers/engine-stubs.js';

describe('statusline', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sl-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('resolveStatuslineCommand prefers PACODE_STATUSLINE_CMD', () => {
    expect(
      resolveStatuslineCommand({ PACODE_STATUSLINE_CMD: 'echo hi' }, home)
    ).toBe('echo hi');
  });

  it('runStatuslineHook returns first stdout line from script', () => {
    const dir = join(home, '.paude');
    writeFileSync(
      join(home, 'hook.sh'),
      `#!/bin/sh\nread line\necho "mode-hook"\n`,
      { mode: 0o755 }
    );
    chmodSync(join(home, 'hook.sh'), 0o755);
    const out = runStatuslineHook(
      { mode: 'default', tokens: 12 },
      { PACODE_STATUSLINE_CMD: join(home, 'hook.sh') },
      home
    );
    expect(out).toBe('mode-hook');
  });

  it('formatStatusBar includes hook output when configured', () => {
    const prev = process.env['PACODE_STATUSLINE_CMD'];
    process.env['PACODE_STATUSLINE_CMD'] = 'printf custom-sl';
    try {
      const bar = formatStatusBar(PermissionMode.DEFAULT, 100, 120);
      expect(bar).toContain('custom-sl');
    } finally {
      if (prev === undefined) delete process.env['PACODE_STATUSLINE_CMD'];
      else process.env['PACODE_STATUSLINE_CMD'] = prev;
    }
  });
});

describe('REPL /btw background', () => {
  beforeEach(() => resetTaskStore());
  afterEach(() => resetTaskStore());

  it('startBackgroundTurn registers TaskStore and completes', async () => {
    const client = createMockAnthropicClient([textEndTurnScenario('bg-done')]);
    const registry = new ToolRegistry();
    const engine = new QueryEngine({
      anthropicClient: client,
      toolRegistry: registry,
      contextAssembler: stubAssembler(),
      compactionPipeline: passthroughCompaction(),
      prefetch: { enabled: false },
    });
    const repl = new REPL({
      apiKey: 'test',
      model: 'mock',
      mode: PermissionMode.BYPASS,
      provider: { name: 'test', apiKey: 'test' },
      engine,
    });

    const id = repl.startBackgroundTurn('background hello');
    expect(id).toMatch(/^task_/);
    expect(getTaskStore().get(id)?.status).toBe('running');
    expect(getTaskStore().get(id)?.background).toBe(true);

    await new Promise((r) => setTimeout(r, 200));
    const done = getTaskStore().get(id);
    expect(done?.status === 'done' || done?.status === 'error' || done?.status === 'running').toBe(
      true
    );
    // wait a bit more for completion
    await new Promise((r) => setTimeout(r, 400));
    expect(getTaskStore().get(id)?.status).toBe('done');
  });
});
