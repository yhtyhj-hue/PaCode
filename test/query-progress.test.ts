/**
 * Query progress line tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryProgressLine } from '../src/cli/query-progress.js';

describe('QueryProgressLine', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('renders Accomplishing timer', () => {
    const line = new QueryProgressLine();
    line.startThinking();
    line.stop();
    expect(writeSpy.mock.calls.some((c) => String(c[0]).includes('Accomplishing'))).toBe(true);
  });

  it('suspend prevents prefetch phase from writing', () => {
    const line = new QueryProgressLine();
    line.startThinking();
    line.suspend();
    writeSpy.mockClear();
    line.setPrefetchPhase('Bash(git diff)');
    expect(writeSpy.mock.calls.length).toBe(0);
  });

  it('renderThoughtSummary is no-op', () => {
    const line = new QueryProgressLine();
    writeSpy.mockClear();
    line.renderThoughtSummary(3000);
    expect(writeSpy.mock.calls.length).toBe(0);
  });
});
