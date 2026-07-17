/**
 * Gate: M5 speed helpers（确定性，无 LLM）
 */
import { describe, it, expect } from 'vitest';
import {
  formatSpeedAssert,
  mapPool,
  meetsSpeedRatio,
  resolveSpeedRatio,
  sumDurationMs,
} from '../evals/lib/m5-speed.js';
import { buildM5CompareReport } from '../evals/lib/m5-cc-runner.js';

describe('m5-speed helpers', () => {
  it('sumDurationMs and meetsSpeedRatio', () => {
    expect(sumDurationMs([{ durationMs: 100 }, { durationMs: 200 }])).toBe(300);
    expect(meetsSpeedRatio(100, 200, 1)).toBe(true);
    expect(meetsSpeedRatio(201, 200, 1)).toBe(false);
    expect(meetsSpeedRatio(240, 200, 1.2)).toBe(true);
    expect(formatSpeedAssert(100, 200, 1)).toContain('OK');
  });

  it('mapPool preserves order under concurrency', async () => {
    const out = await mapPool([1, 2, 3, 4], 2, async (n) => {
      await new Promise((r) => setTimeout(r, (5 - n) * 5));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it('buildM5CompareReport stamps speed fields (wall preferred)', () => {
    const prev = process.env['PACODE_M5_SPEED_RATIO'];
    process.env['PACODE_M5_SPEED_RATIO'] = '1.0';
    try {
      const report = buildM5CompareReport({
        pacode: [
          { taskId: 'a', passed: true, durationMs: 200 },
          { taskId: 'b', passed: true, durationMs: 200 },
        ],
        cc: [
          { taskId: 'a', passed: true, durationMs: 80 },
          { taskId: 'b', passed: true, durationMs: 80 },
        ],
        pacodeWallMs: 90,
        ccWallMs: 100,
        note: 'unit',
        taskIds: ['a', 'b'],
      });
      expect(report.pacodeTotalMs).toBe(400);
      expect(report.ccTotalMs).toBe(160);
      expect(report.speedMetric).toBe('wall');
      expect(report.speedOk).toBe(true);
      expect(report.speedRatio).toBe(resolveSpeedRatio());
    } finally {
      if (prev === undefined) delete process.env['PACODE_M5_SPEED_RATIO'];
      else process.env['PACODE_M5_SPEED_RATIO'] = prev;
    }
  });
});
