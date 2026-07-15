import { describe, it, expect } from 'vitest';
import { formatDagResults, redactSecrets } from '../src/services/agent-scheduler/format-results.js';
import { SECURITY_DIFF_SCAN } from '../src/services/agent-scheduler/git-context.js';
import type { ToolCall, ToolResult } from '../src/pkg/types.js';

function makeRun(name: string, command: string, stdout: string): { tool: ToolCall; result: ToolResult } {
  return {
    tool: { id: 'r1', name, input: { command } },
    result: {
      content: [{ type: 'text', text: stdout }],
      isError: false,
    },
  };
}

describe('redactSecrets', () => {
  it('masks api_key=value occurrences while preserving the key name', () => {
    const out = redactSecrets('config: api_key=sk-abcdef1234567890XYZ');
    expect(out).not.toContain('sk-abcdef1234567890XYZ');
    expect(out).toContain('[REDACTED:api_key]');
  });

  it('masks Bearer tokens (header and inline)', () => {
    const out = redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).toContain('[REDACTED:bearer]');
  });

  it('masks full PEM private key blocks', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
    const out = redactSecrets(`key follows:\n${pem}\nend.`);
    expect(out).not.toContain('MIIEowIBAAKCAQEA');
    expect(out).toContain('[REDACTED:private_key_block]');
    expect(out).toContain('key follows:');
    expect(out).toContain('end.');
  });

  it('masks multiple secret kinds in one block', () => {
    const out = redactSecrets(`
      password=hunter2
      secret=topsecret
      aws_access_key_id=AKIAIOSFODNN7EXAMPLE
    `);
    expect(out).toContain('[REDACTED:password]');
    expect(out).toContain('[REDACTED:secret]');
    expect(out).toContain('[REDACTED:aws_access_key_id]');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('topsecret');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('leaves non-secret text untouched', () => {
    const safe = 'normal log line\nfile changed: src/index.ts\nno secrets here';
    expect(redactSecrets(safe)).toBe(safe);
  });
});

describe('formatDagResults — SECURITY_DIFF_SCAN redaction', () => {
  // 使用生产真实命令（带 SECURITY_DIFF_SCAN 标识）
  const SCAN_CMD = SECURITY_DIFF_SCAN;

  it('masks secret lines when tool is SECURITY_DIFF_SCAN Bash run', () => {
    const run = makeRun('Bash', SCAN_CMD, 'src/x.ts: api_key=AKIAIOSFODNN7EXAMPLE');
    const out = formatDagResults('review_implementation', [run]);
    expect(out).toContain('[REDACTED:api_key]');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain('src/x.ts:'); // file path / line number preserved
  });

  it('does NOT mask non-security Bash output (preserves observability)', () => {
    const run = makeRun('Bash', 'ls -la', 'password=hunter2 (just a filename in listing)');
    const out = formatDagResults('code_audit', [run]);
    expect(out).toContain('password=hunter2');
  });

  it('does NOT mask other tool outputs even if they mention secrets', () => {
    const run = {
      tool: { id: 'r1', name: 'Read', input: { path: 'config.ts' } },
      result: { content: [{ type: 'text', text: 'api_key=literal_in_file' }], isError: false },
    };
    const out = formatDagResults('code_audit', [run as { tool: ToolCall; result: ToolResult }]);
    expect(out).toContain('api_key=literal_in_file');
  });
});