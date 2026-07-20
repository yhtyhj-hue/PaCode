/**
 * BashOutput / BashStop 错误分支（抬 branches 覆盖）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerBashOutputTools } from '../src/tools/bash-output.js';
import { resetBashJobStore } from '../src/services/bash-jobs/index.js';

describe('BashOutput / BashStop tools', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    resetBashJobStore();
    registry = new ToolRegistry();
    registerBashOutputTools(registry);
  });

  afterEach(() => resetBashJobStore());

  it('BashOutput returns error for unknown bash_id', async () => {
    const tool = registry.get('BashOutput')!;
    const result = await tool.execute({ bash_id: 'missing-id' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === 'text' && result.content[0].text).toBeTruthy();
  });

  it('BashStop returns error for unknown bash_id', async () => {
    const tool = registry.get('BashStop')!;
    const result = await tool.execute({ bash_id: 'missing-id' });
    expect(result.isError).toBe(true);
  });

  it('BashStop succeeds for a started job', async () => {
    const { getBashJobStore } = await import('../src/services/bash-jobs/index.js');
    const started = getBashJobStore().start('sleep 2');
    expect('job' in started).toBe(true);
    if (!('job' in started)) return;
    const tool = registry.get('BashStop')!;
    const result = await tool.execute({ bash_id: started.job.id });
    expect(result.isError).not.toBe(true);
    expect(String(result.content[0] && 'text' in result.content[0] ? result.content[0].text : '')).toContain(
      'stop_requested'
    );
  });
});
