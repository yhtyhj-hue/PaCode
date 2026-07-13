/**
 * MCP config validation tests
 */

import { describe, it, expect } from 'vitest';
import { validateMcpServerEntry, formatMcpConnectError } from '../src/mcp/validate.js';

describe('validateMcpServerEntry', () => {
  it('rejects shell echo as MCP server', () => {
    const err = validateMcpServerEntry({ type: 'stdio', command: 'echo' });
    expect(err).toContain('shell utility');
    expect(err).toContain('not an MCP server');
  });

  it('allows npx MCP server commands', () => {
    expect(
      validateMcpServerEntry({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      })
    ).toBeNull();
  });

  it('rejects unsupported transport', () => {
    expect(validateMcpServerEntry({ type: 'sse', url: 'http://x' })).toContain('not supported');
  });

  it('rejects missing command', () => {
    expect(validateMcpServerEntry({ type: 'stdio' })).toContain('requires a command');
  });
});

describe('formatMcpConnectError', () => {
  it('adds hint for connection closed', () => {
    const msg = formatMcpConnectError('echo', 'echo', 'MCP error -1: Connection closed');
    expect(msg).toContain('Connection closed');
    expect(msg).toContain('shell utility');
  });
});
