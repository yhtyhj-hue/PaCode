/**
 * Gate: CC-style live task panel + Bash Running line
 */

import { describe, it, expect } from 'vitest';
import {
  formatTaskPanelBlock,
  resolveTaskPanelTitle,
} from '../../src/cli/live-task-panel.js';
import {
  formatRunningLine,
  isLongRunningTool,
} from '../../src/cli/tool-running-line.js';
import { getDefaultAgentSystemPrompt } from '../../src/agent/system-prompt.js';

describe('eval:gate:live-task-ui', () => {
  it('formats CC-like task tree with ■/□ and elapsed tokens', () => {
    const out = formatTaskPanelBlock(
      [
        { label: '扫描覆盖率报告与阈值基线', status: 'completed' },
        { label: '跑 npm test + eval:gate 验证基线', status: 'in_progress' },
        { label: '审计 src 模块', status: 'pending' },
      ],
      { elapsedSec: 64, outputTokens: 1900, maxVisible: 5 }
    );
    expect(out).toMatch(/1m 4s/);
    expect(out).toMatch(/1\.9k tokens/);
    expect(out).toContain('■');
    expect(out).toContain('□');
    expect(resolveTaskPanelTitle([{ label: '分析覆盖率报告', status: 'in_progress' }])).toBe(
      '分析覆盖率报告…'
    );
  });

  it('shows Bash Running line helpers', () => {
    expect(isLongRunningTool('Bash')).toBe(true);
    expect(formatRunningLine(4, '5m')).toMatch(/Running…/);
    expect(formatRunningLine(4, '5m')).toMatch(/timeout 5m/);
  });

  it('system prompt nudges TodoWrite for multi-step work', () => {
    const prompt = getDefaultAgentSystemPrompt({ cwd: '/tmp' });
    expect(prompt).toContain('TodoWrite');
    expect(prompt).toContain('todos');
  });
});
