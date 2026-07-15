/**
 * Plan parser tests
 */

import { describe, it, expect } from 'vitest';
import { parsePlanFromMarkdown, extractLastAssistantText } from '../src/agent/plan-parser.js';
import { Message } from '../src/pkg/types.js';

const SAMPLE_PLAN = `# Add User Auth

Implement JWT-based login for the API.

## Steps

1. 🟢 **Read existing auth module** _(Read)_
   Scan src/auth/ for current patterns
2. 🟡 **Add login endpoint** _(Edit)_
   Create POST /api/login handler
3. 🔴 **Run migration** _(Bash)_
   Apply database schema changes
`;

describe('parsePlanFromMarkdown', () => {
  it('extracts title, description, and steps', () => {
    const parsed = parsePlanFromMarkdown(SAMPLE_PLAN, 'fallback');
    expect(parsed.title).toBe('Add User Auth');
    expect(parsed.description).toContain('JWT');
    expect(parsed.steps).toHaveLength(3);
    expect(parsed.steps[0]?.tool).toBe('Read');
    expect(parsed.steps[0]?.estimatedRisk).toBe('low');
    expect(parsed.steps[2]?.estimatedRisk).toBe('high');
  });

  it('falls back to numbered lines without ## Steps', () => {
    const md = `# Simple Plan

Do the thing.

1. First step here
2. Second step here
`;
    const parsed = parsePlanFromMarkdown(md, 'task');
    expect(parsed.steps.length).toBeGreaterThanOrEqual(2);
  });
});

describe('extractLastAssistantText', () => {
  it('reads string content', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hi', timestamp: 1 },
      { role: 'assistant', content: 'hello plan', timestamp: 2 },
    ];
    expect(extractLastAssistantText(messages)).toBe('hello plan');
  });

  it('reads block content', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [{ type: 'text' as const, text: 'block text' }],
        timestamp: 1,
      },
    ];
    expect(extractLastAssistantText(messages)).toBe('block text');
  });
});
