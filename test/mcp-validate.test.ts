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

  it('allows sse/http with valid url (K5)', () => {
    expect(validateMcpServerEntry({ type: 'sse', url: 'https://mcp.example/sse' })).toBeNull();
    expect(
      validateMcpServerEntry({
        type: 'http',
        url: 'https://mcp.example/mcp',
        headers: { Authorization: 'Bearer x' },
      })
    ).toBeNull();
  });

  it('rejects sse/http without url', () => {
    expect(validateMcpServerEntry({ type: 'http' })).toContain('requires a url');
  });

  it('allows websocket with ws/wss url', () => {
    expect(validateMcpServerEntry({ type: 'websocket', url: 'ws://x' })).toBeNull();
    expect(validateMcpServerEntry({ type: 'websocket', url: 'wss://mcp.example/ws' })).toBeNull();
  });

  it('rejects websocket with http url', () => {
    expect(validateMcpServerEntry({ type: 'websocket', url: 'https://x' })).toMatch(/ws:\/\//);
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
