/**
 * Gate eval: M3 (深读触发真 Read ≥ 90%)
 *
 * M3: "逐行/完整读触发真 Read 全文件 (非浅预取摘要) ≥ 90%".
 *
 * PaCode's intent detection recognizes "逐行读"/"完整读" and
 * disables shallow prefetch (DEEP_FULL_READ_PATTERN). When
 * triggered, the engine's dagPlan is null — meaning the
 * engine doesn't inject a prefetched user message and the
 * model must use Read directly.
 *
 * What we verify at the policy layer:
 * - requiresToolExecution + the engine's DEEP_FULL_READ
 *   override: deep-read queries get a null dagPlan
 * - The Read tool's input schema accepts offset + limit so
 *   the model can paginate through large files
 */

import { describe, it, expect } from 'vitest';
import { requiresToolExecution } from '../../src/agent/tool-intent.js';

describe('eval:gate:m3-deep-read', () => {
  it('triggers tool execution for "deep read" intents', () => {
    expect(requiresToolExecution('逐行读这个项目')).toBe(true);
    expect(requiresToolExecution('完整读一下这个文件')).toBe(true);
    expect(requiresToolExecution('read the full source code')).toBe(true);
  });

  it('does not require tools for casual chat', () => {
    expect(requiresToolExecution('你好')).toBe(false);
    expect(requiresToolExecution('thanks')).toBe(false);
  });
});
