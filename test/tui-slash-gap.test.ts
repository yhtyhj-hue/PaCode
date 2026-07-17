/**
 * TUI slash gap: context / memory / model / providers / cron / init
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionMode, type SessionState } from '../src/pkg/types.js';
import {
  formatContextLines,
  formatMemoryLines,
  formatModelLines,
  formatProvidersLines,
} from '../src/cli/info-display.js';
import { initClaudeMd } from '../src/cli/init-display.js';
import { formatCronLines } from '../src/cli/cron-display.js';
import { resetCronStore, getCronStore } from '../src/services/cron/index.js';
import { handleTuiSlash, TUI_SLASH_HELP } from '../src/cli/tui/slash.js';
import type { OutputStyle } from '../src/cli/output-styles.js';

beforeEach(() => resetCronStore());
afterEach(() => resetCronStore());

describe('info-display helpers', () => {
  it('formats context memory model providers', () => {
    expect(formatContextLines({ messageCount: 3, inputTokens: 10, outputTokens: 5 }).join('\n')).toMatch(
      /Messages:\s+3/
    );
    expect(formatMemoryLines('/tmp/proj').some((l) => l.includes('.paude'))).toBe(true);
    expect(formatModelLines('claude-x')[0]).toContain('claude-x');
    expect(formatProvidersLines([], undefined)[1]).toMatch(/No providers/);
  });
});

describe('init + cron display', () => {
  it('creates CLAUDE.md once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacode-init-'));
    try {
      const r1 = initClaudeMd(dir);
      expect(r1.ok).toBe(true);
      expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toContain('CLAUDE.md');
      const r2 = initClaudeMd(dir);
      expect(r2.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cron create list delete', () => {
    const created = formatCronLines(['create', 'every:5m', 'ping']);
    expect(created[0]).toMatch(/Scheduled/);
    const list = formatCronLines(['list']).join('\n');
    expect(list).toContain('jobs');
    const id = getCronStore().list()[0]!.id;
    expect(formatCronLines(['delete', id])[0]).toContain('Deleted');
  });
});

describe('TUI handlers', () => {
  it('help lists new commands; handlers respond', async () => {
    for (const name of ['context', 'memory', 'model', 'providers', 'cron', 'init']) {
      expect(TUI_SLASH_HELP).toContain(`/${name}`);
    }

    const lines: string[] = [];
    let model = 'm0';
    const ctl = {
      appendSystem: (l: string) => lines.push(l),
      appendError: (l: string) => lines.push(`ERR:${l}`),
      setMode: () => undefined,
      askConfirm: async () => true,
      askText: async () => '',
      appendUser: () => undefined,
      appendTool: () => undefined,
      appendAssistantDelta: () => undefined,
      setBusy: () => undefined,
      setStatus: () => undefined,
      requestInterrupt: () => undefined,
    };
    const session = {
      sessionId: 's',
      messages: [{ role: 'user', content: 'x', timestamp: 1 }],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    } as SessionState;

    const dir = mkdtempSync(join(tmpdir(), 'pacode-tui-gap-'));
    try {
      const ctx = {
        ctl: ctl as never,
        session,
        model,
        apiKeyPresent: true,
        tokenUsage: { input: 1, output: 2 },
        outputStyle: 'default' as OutputStyle,
        setOutputStyle: () => undefined,
        setModel: (m: string) => {
          model = m;
        },
        cwd: dir,
      };

      lines.length = 0;
      expect(await handleTuiSlash('/context', ctx)).toBe(true);
      expect(lines.some((l) => /Messages/.test(l))).toBe(true);

      lines.length = 0;
      expect(await handleTuiSlash('/memory', ctx)).toBe(true);
      expect(lines.some((l) => /User memory/.test(l))).toBe(true);

      lines.length = 0;
      expect(await handleTuiSlash('/model claude-test', ctx)).toBe(true);
      expect(model).toBe('claude-test');

      lines.length = 0;
      expect(await handleTuiSlash('/providers', ctx)).toBe(true);
      expect(lines.some((l) => /API Providers|No providers/.test(l))).toBe(true);

      lines.length = 0;
      expect(await handleTuiSlash('/cron list', ctx)).toBe(true);
      expect(lines.join('\n')).toContain('jobs');

      lines.length = 0;
      expect(await handleTuiSlash('/init', ctx)).toBe(true);
      expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
