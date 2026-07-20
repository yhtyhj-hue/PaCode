/**
 * Wave C: SDK runAgent + CLI -p parse
 */

import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../src/cli/args.js';
import { runAgent } from '../src/sdk/run-agent.js';
import { PermissionMode } from '../src/pkg/types.js';
import {
  createMockAnthropicClient,
  textEndTurnScenario,
} from './helpers/mock-anthropic.js';

describe('CLI -p / --print', () => {
  it('parses short and long print flags', () => {
    expect(parseCliArgs(['-p', 'hello']).values.print).toBe(true);
    expect(parseCliArgs(['--print', 'hello']).values.print).toBe(true);
    expect(parseCliArgs(['hello']).values.print).toBe(false);
  });
});

describe('runAgent SDK', () => {
  it('collects assistant text with mock client', async () => {
    const client = createMockAnthropicClient([textEndTurnScenario('sdk-ok')]);
    const result = await runAgent({
      message: 'hi',
      mode: PermissionMode.BYPASS,
      anthropicClient: client,
      connectMcp: false,
      bootstrapPlugins: false,
    });
    expect(result.text).toContain('sdk-ok');
    expect(result.hadError).toBe(false);
  });
});
