/**
 * Gate eval: M1 (fake completion rate → 0)
 *
 * M1: "假完成率 (声称检查/已测但无 tool 证据) → 0".
 *
 * M1 has two policy-level invariants the engine must enforce:
 * (a) requiresToolExecution() must return true for "deep check"
 *     intents so the engine knows to demand tool evidence.
 * (b) When the model returns end_turn with zero tool_calls and
 *     mustUseTools is true, the engine nudges (TOOL_NUDGE_MESSAGE)
 *     and eventually surfaces TOOL_REQUIRED — never silently
 *     accepting a no-evidence answer.
 *
 * The deep-loop behavior is covered in test/engine-query.test.ts;
 * here we lock the policy shape so a future refactor can't
 * quietly weaken it.
 */

import { describe, it, expect } from 'vitest';
import { requiresToolExecution } from '../../src/agent/tool-intent.js';
import { MAX_TOOL_NUDGE_RETRIES } from '../../src/agent/engine.js';

describe('eval:gate:m1-fake-completion', () => {
  it('triggers tool execution for "deep check" intents', () => {
    expect(requiresToolExecution('分析这个项目')).toBe(true);
    expect(requiresToolExecution('check the project')).toBe(true);
    expect(requiresToolExecution('对项目做一次深度质检')).toBe(true);
  });

  it('does NOT require tools for casual chat (the opposite case)', () => {
    expect(requiresToolExecution('你好')).toBe(false);
    expect(requiresToolExecution('thanks')).toBe(false);
    expect(requiresToolExecution('OK')).toBe(false);
  });

  it('engine caps the tool-nudge retry loop (TOOL_REQUIRED surfaces)', () => {
    // If the model ignores the nudge MAX_TOOL_NUDGE_RETRIES times,
    // the engine surfaces TOOL_REQUIRED rather than continuing
    // to accept a no-evidence answer. The constant exists; if a
    // future refactor sets it to 0 or Infinity, M1 silently breaks.
    expect(MAX_TOOL_NUDGE_RETRIES).toBeGreaterThan(0);
    expect(MAX_TOOL_NUDGE_RETRIES).toBeLessThanOrEqual(3);
  });

  it('engine source does not mark toolsUsedInQuery at prefetch start', async () => {
    // 失败预取不得关掉 M1：toolsUsedInQuery 只在有成功预取或模型 tool_use 后置位
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/agent/engine.ts'), 'utf-8');
    const prefetchBlock = src.slice(
      src.indexOf('dagPrefetched = true'),
      src.indexOf('// 仅当至少一条预取成功时计为证据')
    );
    expect(prefetchBlock).not.toMatch(/toolsUsedInQuery\s*=\s*true/);
    expect(src).toMatch(/runs\.some\(\(r\) => !r\.result\.isError\)/);
  });
});
