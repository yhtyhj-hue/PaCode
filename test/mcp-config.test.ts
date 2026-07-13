/**
 * MCP config persistence tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMcpConfig, saveMcpConfig } from '../src/mcp/config.js';

describe('mcp config', () => {
  let configPath: string;

  beforeEach(() => {
    configPath = join(tmpdir(), `pacode-mcp-${Date.now()}.json`);
  });

  afterEach(() => {
    if (existsSync(configPath)) rmSync(configPath, { force: true });
  });

  it('save and load round-trip', () => {
    saveMcpConfig(
      {
        servers: {
          test: { type: 'stdio', command: 'node', args: ['server.js'] },
        },
      },
      configPath
    );

    const loaded = loadMcpConfig(configPath);
    expect(loaded.servers.test?.command).toBe('node');
    expect(loaded.servers.test?.args).toEqual(['server.js']);
  });

  it('returns empty when file missing', () => {
    expect(loadMcpConfig(configPath).servers).toEqual({});
  });
});
