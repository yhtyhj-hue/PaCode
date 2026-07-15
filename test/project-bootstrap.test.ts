/**
 * Project bootstrap tests
 */

import { describe, it, expect } from 'vitest';
import {
  createProjectBootstrapCalls,
} from '../src/agent/project-bootstrap.js';
import { formatDagResults } from '../src/services/agent-scheduler/index.js';
import { serializeMessagesForApi } from '../src/agent/message-serializer.js';

describe('project-bootstrap', () => {
  it('creates compact read-only bootstrap sequence', () => {
    const calls = createProjectBootstrapCalls();
    expect(calls.length).toBeGreaterThanOrEqual(7);
    expect(calls.some((c) => c.name === 'Read')).toBe(true);
    expect(calls.some((c) => c.name === 'Bash')).toBe(true);
    expect(calls.some((c) => c.name === 'Glob')).toBe(true);
    expect(new Set(calls.map((c) => c.id)).size).toBe(calls.length);
  });

  it('formats bootstrap output as plain user text for API', () => {
    const text = formatDagResults('inspect_project', [
      {
        tool: { id: 'b1', name: 'Read', input: { path: 'package.json' } },
        result: { content: [{ type: 'text', text: '{"name":"pacode"}' }] },
      },
    ]);

    expect(text).toContain('项目检查已完成');
    expect(text).toContain('Read');
    expect(text).toContain('pacode');

    const api = serializeMessagesForApi([
      { role: 'user', content: text, timestamp: Date.now() },
    ]);
    expect(typeof api[0]?.content).toBe('string');
  });
});
