/**
 * TUI /plan read-only display
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPlanManager, resetPlanManager } from '../src/agent/plan-mode.js';
import { formatPlanReadOnlyLines } from '../src/cli/plan-display.js';
import { handleTuiSlash, TUI_SLASH_HELP } from '../src/cli/tui/slash.js';
import { PermissionMode, type SessionState } from '../src/pkg/types.js';
import type { OutputStyle } from '../src/cli/output-styles.js';

beforeEach(() => resetPlanManager());
afterEach(() => resetPlanManager());

describe('plan-display TUI', () => {
  it('lists and reports active plan', () => {
    const pm = getPlanManager();
    const plan = pm.createPlan('T', 'd', [
      { index: 0, action: 'a', description: 'A', estimatedRisk: 'low' },
    ]);
    pm.approve(plan.id);
    pm.startExecution(plan.id);
    pm.beginCurrentStep(plan.id);
    pm.advanceAfterTurn(plan.id);

    const list = formatPlanReadOnlyLines('list');
    expect(list.some((l) => l.includes(plan.id))).toBe(true);

    const report = formatPlanReadOnlyLines('report').join('\n');
    expect(report).toContain('[Plan report]');
  });

  it('TUI /plan is handled', async () => {
    expect(TUI_SLASH_HELP).toMatch(/plan/);
    const lines: string[] = [];
    const ctl = {
      appendSystem: (l: string) => lines.push(l),
      appendError: () => undefined,
      setMode: () => undefined,
      askConfirm: async () => true,
      askText: async () => '',
    };
    const session = {
      sessionId: 'p1',
      messages: [],
      mode: PermissionMode.DEFAULT,
    } as unknown as SessionState;
    const ctx = {
      ctl: ctl as never,
      session,
      model: 'm',
      apiKeyPresent: true,
      tokenUsage: { input: 0, output: 0 },
      outputStyle: 'default' as OutputStyle,
      setOutputStyle: () => undefined,
    };
    expect(await handleTuiSlash('/plan', ctx)).toBe(true);
    expect(lines.some((l) => /Usage: \/plan|No plans|Status:/.test(l) || l.includes('read-only'))).toBe(true);
  });
});
