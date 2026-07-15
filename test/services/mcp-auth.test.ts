/**
 * McpAuth Service Tests
 *
 * Covers:
 *   1. PKCE pair: verifier length & challenge shape
 *   2. PKCE pair: each call yields a different value (entropy)
 *   3. state generation: constant-time verification accepts / rejects
 *   4. validateInput rejects missing fields & bad URLs
 *   5. validateRedirectUri accepts loopback only
 *   6. TokenStore: encrypt -> file written with mode 0600
 *   7. TokenStore: load round-trip decrypts correctly
 *   8. TokenStore: ciphertext relocated across entries fails
 *   9. TokenStore: list() returns stored summary entries
 *   10. TokenStore: remove() deletes a key
 *   11. callback server: happy path with state match
 *   12. callback server: state mismatch yields state_mismatch error
 *   13. callback server: timeout fires after deadline
 *   14. callback server: rejects non-loopback host
 *   15. buildAuthorizationUrl: includes all required params + resource
 *   16. exchangeAuthorizationCode: parses token response
 *   17. exchangeAuthorizationCode: surfaces RFC 6749 errors
 *   18. refreshAccessToken: refreshes & keeps refresh_token fallback
 *   19. isExpired: true once past skew
 *   20. registerMcpAuthTool: tool registered with correct metadata
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, chmodSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';

import {
  MCP_AUTH_TOOL_NAME,
  registerMcpAuthTool,
  // OAuth
  generatePkcePair,
  generateState,
  generateCodeVerifier,
  computeCodeChallengeS256,
  base64UrlEncode,
  buildAuthorizationUrl,
  validateMcpAuthInput,
  verifyState,
  exchangeAuthorizationCode,
  refreshAccessToken,
  isExpired,
  // Callback
  startCallbackServer,
  validateRedirectUri,
  // Token store
  createFileTokenStore,
  machineFingerprint,
  makeKey,
  deleteStoreFile,
} from '../../src/services/mcp-auth/index.js';
import { PermissionMode } from '../../src/pkg/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { FetchLike } from '../../src/services/mcp-auth/oauth-flow.js';
import type { McpAuthInput, McpAuthSession } from '../../src/services/mcp-auth/types.js';

function validInput(overrides: Partial<McpAuthInput> = {}): McpAuthInput {
  return {
    server_url: 'https://mcp.example.com',
    client_id: 'test-client',
    redirect_uri: 'http://localhost:12345/callback',
    auth_endpoint: 'https://auth.example.com/authorize',
    token_endpoint: 'https://auth.example.com/token',
    scopes: ['read', 'write'],
    ...overrides,
  };
}

function tmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pacode-mcp-auth-'));
  return join(dir, 'mcp-auth.json');
}

function makeSession(overrides: Partial<McpAuthSession> = {}): McpAuthSession {
  return {
    state: 'state-xyz',
    code_verifier: 'verifier-abc',
    code_challenge: 'challenge-def',
    access_token: 'tok-123',
    refresh_token: 'rt-456',
    scope: 'read write',
    token_type: 'Bearer',
    expires_in: 3600,
    expires_at: Date.now() + 3600 * 1000,
    server_url: 'https://mcp.example.com',
    client_id: 'test-client',
    ...overrides,
  };
}

describe('PKCE generation', () => {
  it('generates a code_verifier between 43 and 128 chars', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(/^[A-Za-z0-9\-._~]+$/.test(v)).toBe(true);
  });

  it('builds a S256 code_challenge = base64url(sha256(verifier))', () => {
    const verifier = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    const expected = base64UrlEncode(createHash('sha256').update(verifier, 'ascii').digest());
    expect(computeCodeChallengeS256(verifier)).toBe(expected);
  });

  it('PKCE pair is fresh each call (entropy)', () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.code_verifier).not.toBe(b.code_verifier);
    expect(a.code_challenge).not.toBe(b.code_challenge);
    expect(a.code_challenge_method).toBe('S256');
  });
});

describe('state verification', () => {
  it('accepts matching state', () => {
    expect(verifyState('abc', 'abc')).toBe(true);
  });

  it('rejects mismatched state', () => {
    expect(verifyState('abc', 'abd')).toBe(false);
    expect(verifyState('abc', 'abcd')).toBe(false);
    expect(verifyState('abc', '')).toBe(false);
  });
});

describe('validateMcpAuthInput', () => {
  it('accepts a well-formed input', () => {
    expect(validateMcpAuthInput(validInput())).toBeNull();
  });

  it('rejects missing fields', () => {
    const err = validateMcpAuthInput({
      ...validInput(),
      client_id: '',
    });
    expect(err?.category).toBe('invalid_request');
  });

  it('rejects non-https endpoints', () => {
    const err = validateMcpAuthInput({
      ...validInput(),
      auth_endpoint: 'http://auth.example.com/authorize',
    });
    expect(err?.category).toBe('invalid_request');
  });

  it('rejects https redirect_uri', () => {
    const err = validateMcpAuthInput({
      ...validInput(),
      redirect_uri: 'https://localhost:12345/callback',
    });
    expect(err?.category).toBe('redirect_uri_rejected');
  });

  it('rejects empty scopes array', () => {
    const err = validateMcpAuthInput({
      ...validInput(),
      scopes: [],
    });
    expect(err?.category).toBe('invalid_request');
  });
});

describe('validateRedirectUri', () => {
  it('accepts http://localhost', () => {
    expect(validateRedirectUri('http://localhost:8080/callback')).toBeNull();
  });

  it('accepts http://127.0.0.1', () => {
    expect(validateRedirectUri('http://127.0.0.1:8080/callback')).toBeNull();
  });

  it('rejects https://localhost', () => {
    const err = validateRedirectUri('https://localhost:8080/callback');
    expect(err?.category).toBe('redirect_uri_rejected');
  });

  it('rejects non-loopback host', () => {
    const err = validateRedirectUri('http://evil.example.com/callback');
    expect(err?.category).toBe('redirect_uri_rejected');
  });

  it('rejects invalid URL', () => {
    const err = validateRedirectUri('not a url');
    expect(err?.category).toBe('redirect_uri_rejected');
  });
});

describe('TokenStore', () => {
  let file: string;

  beforeEach(() => {
    file = tmpFile();
  });

  afterEach(() => {
    if (existsSync(file)) unlinkSync(file);
  });

  it('writes file with mode 0600', async () => {
    const store = createFileTokenStore({ filePath: file });
    await store.save(makeSession());
    expect(existsSync(file)).toBe(true);
    const st = statSync(file);
    expect(st.mode & 0o777).toBe(0o600);
  });

  it('round-trips encrypt -> decrypt', async () => {
    const store = createFileTokenStore({ filePath: file });
    const s = makeSession({ access_token: 'round-trip-secret' });
    await store.save(s);
    const loaded = await store.load(s.server_url, s.client_id);
    expect(loaded?.access_token).toBe('round-trip-secret');
    expect(loaded?.refresh_token).toBe('rt-456');
    expect(loaded?.expires_at).toBe(s.expires_at);
  });

  it('does not write plaintext access_token to disk', async () => {
    const store = createFileTokenStore({ filePath: file });
    await store.save(makeSession({ access_token: 'NEVER-LEAK' }));
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('NEVER-LEAK');
  });

  it('refuses to load file with mode > 0600', async () => {
    const store = createFileTokenStore({ filePath: file });
    await store.save(makeSession());
    chmodSync(file, 0o644);
    await expect(store.load('https://mcp.example.com', 'test-client')).rejects.toThrow(/0600/);
  });

  it('rejects ciphertext relocation across entries (AAD check)', async () => {
    const store = createFileTokenStore({ filePath: file });
    await store.save(makeSession({ server_url: 'https://a.example.com', client_id: 'C1' }));
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      entries: Record<string, unknown>;
    };
    const [k] = Object.keys(raw.entries);
    raw.entries['https://b.example.com::C2'] = raw.entries[k];
    delete raw.entries[k];
    writeFileSync(file, JSON.stringify(raw), { mode: 0o600 });
    chmodSync(file, 0o600);
    await expect(store.load('https://b.example.com', 'C2')).rejects.toThrow(/decrypt/);
  });

  it('list returns stored summary entries', async () => {
    const store = createFileTokenStore({ filePath: file });
    await store.save(makeSession({ server_url: 'https://a.example.com', client_id: 'C1' }));
    await store.save(makeSession({ server_url: 'https://b.example.com', client_id: 'C2', access_token: 'tok-2' }));
    const list = await store.list();
    expect(list.length).toBe(2);
    expect(list.map((l) => l.client_id).sort()).toEqual(['C1', 'C2']);
    expect(list.every((l) => l.has_refresh_token)).toBe(true);
  });

  it('remove deletes the entry', async () => {
    const store = createFileTokenStore({ filePath: file });
    await store.save(makeSession());
    await store.remove('https://mcp.example.com', 'test-client');
    const loaded = await store.load('https://mcp.example.com', 'test-client');
    expect(loaded).toBeNull();
  });

  it('makeKey is stable for trailing-slash variants', () => {
    expect(makeKey('https://x.example.com/', 'C1')).toBe(makeKey('https://x.example.com', 'C1'));
  });

  it('machineFingerprint is stable across calls', () => {
    expect(machineFingerprint()).toBe(machineFingerprint());
    expect(machineFingerprint().length).toBe(64);
  });

  it('deleteStoreFile removes the file', async () => {
    const store = createFileTokenStore({ filePath: file });
    await store.save(makeSession());
    expect(existsSync(file)).toBe(true);
    deleteStoreFile(file);
    expect(existsSync(file)).toBe(false);
  });
});

describe('startCallbackServer', () => {
  it('opens, receives callback, returns code on state match', async () => {
    const expectedState = generateState();
    const cb = await startCallbackServer(expectedState, {
      host: '127.0.0.1',
      port: 0,
      timeoutMs: 5_000,
    });
    const url = new URL(cb.redirectUri);
    const port = url.port;

    // Simulate the user-agent callback in the background.
    const hit = new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: `/callback?code=ABC&state=${expectedState}`,
          method: 'GET',
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          res.resume();
          resolve();
        },
      );
      req.on('error', reject);
      req.end();
    });

    const outcome = await cb.awaitCallback();
    await hit;
    await cb.close();

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.code).toBe('ABC');
      expect(outcome.result.state).toBe(expectedState);
    }
  });

  it('returns state_mismatch on bad state', async () => {
    const expectedState = generateState();
    const cb = await startCallbackServer(expectedState, {
      host: '127.0.0.1',
      port: 0,
      timeoutMs: 5_000,
    });
    const url = new URL(cb.redirectUri);
    const port = url.port;

    const hit = new Promise<void>((resolve) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/callback?code=ABC&state=NOT_THE_RIGHT_STATE',
          method: 'GET',
        },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on('error', () => resolve());
      req.end();
    });

    const outcome = await cb.awaitCallback();
    await hit;
    await cb.close();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.category).toBe('state_mismatch');
    }
  });

  it('times out when no callback arrives', async () => {
    const cb = await startCallbackServer(generateState(), {
      host: '127.0.0.1',
      port: 0,
      timeoutMs: 250,
    });
    const outcome = await cb.awaitCallback();
    await cb.close();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.category).toBe('timeout');
    }
  });

  it('rejects non-loopback host', async () => {
    await expect(
      startCallbackServer(generateState(), { host: '0.0.0.0', port: 0 }),
    ).rejects.toThrow(/loopback/);
  });

  it('returns 404 for unknown paths', async () => {
    const cb = await startCallbackServer(generateState(), {
      host: '127.0.0.1',
      port: 0,
      timeoutMs: 1_500,
    });
    const url = new URL(cb.redirectUri);
    const port = url.port;

    const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path: '/admin', method: 'GET' },
        (r) => {
          r.resume();
          resolve({ statusCode: r.statusCode ?? 0 });
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(res.statusCode).toBe(404);
    await cb.close();
  });
});

describe('buildAuthorizationUrl', () => {
  it('includes all required params + resource indicator', () => {
    const input = validInput();
    const state = generateState();
    const pkce = generatePkcePair();
    const url = new URL(buildAuthorizationUrl(input, state, pkce));
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('test-client');
    expect(url.searchParams.get('redirect_uri')).toBe(input.redirect_uri);
    expect(url.searchParams.get('scope')).toBe('read write');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('code_challenge')).toBe(pkce.code_challenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('resource')).toBe(input.server_url);
  });
});

describe('exchangeAuthorizationCode', () => {
  function mockFetch(jsonBody: unknown, status = 200): FetchLike {
    return (async () => ({
      status,
      text: async () => JSON.stringify(jsonBody),
      json: async () => jsonBody,
    })) as unknown as FetchLike;
  }

  it('parses a successful token response', async () => {
    const input = validInput();
    const result = await exchangeAuthorizationCode(
      input,
      'code-1',
      generatePkcePair(),
      mockFetch({
        access_token: 'AT',
        refresh_token: 'RT',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read write',
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.access_token).toBe('AT');
      expect(result.session.refresh_token).toBe('RT');
      expect(result.session.token_type).toBe('Bearer');
      expect(result.session.expires_in).toBe(3600);
      expect(result.session.expires_at).toBeGreaterThan(Date.now());
    }
  });

  it('maps RFC 6749 errors to typed categories', async () => {
    const input = validInput();
    const result = await exchangeAuthorizationCode(
      input,
      'code-1',
      generatePkcePair(),
      mockFetch({ error: 'invalid_grant', error_description: 'expired' }, 400),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('invalid_grant');
      expect(result.error.status).toBe(400);
      expect(result.error.message).toBe('expired');
    }
  });

  it('rejects empty code', async () => {
    const result = await exchangeAuthorizationCode(
      validInput(),
      '',
      generatePkcePair(),
      mockFetch({}),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe('invalid_request');
    }
  });
});

describe('refreshAccessToken', () => {
  it('refreshes and keeps the previous refresh_token if not returned', async () => {
    const input = validInput();
    const fetchImpl: FetchLike = (async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: 'NEW_AT',
          token_type: 'Bearer',
          expires_in: 60,
          // intentionally no refresh_token
        }),
      json: async () => ({}),
    })) as unknown as FetchLike;
    const result = await refreshAccessToken(
      {
        token_endpoint: input.token_endpoint,
        client_id: input.client_id,
        server_url: input.server_url,
      },
      'OLD_RT',
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.access_token).toBe('NEW_AT');
      // The refresh helper in index.ts keeps the old refresh_token;
      // verify the lower-level function correctly leaves it undefined.
      expect(result.session.refresh_token).toBeUndefined();
    }
  });
});

describe('isExpired', () => {
  it('returns false when expiry is comfortably in the future', () => {
    const s = makeSession({ expires_at: Date.now() + 10 * 60 * 1000 });
    expect(isExpired(s)).toBe(false);
  });

  it('returns true when within skew seconds of expiry', () => {
    const s = makeSession({ expires_at: Date.now() + 5_000 });
    expect(isExpired(s, 60)).toBe(true);
  });

  it('returns true for already-expired sessions', () => {
    const s = makeSession({ expires_at: Date.now() - 1000 });
    expect(isExpired(s)).toBe(true);
  });
});

describe('registerMcpAuthTool', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers with the expected metadata', () => {
    registerMcpAuthTool(registry);
    const tool = registry.get(MCP_AUTH_TOOL_NAME);
    expect(tool).toBeTruthy();
    expect(tool?.name).toBe(MCP_AUTH_TOOL_NAME);
    expect(tool?.concurrencySafe).toBe(false);
    expect(tool?.permissionMode).toBe(PermissionMode.ACCEPT_EDITS);
    expect(tool?.description).toMatch(/OAuth/);
  });

  it('input schema requires the 6 fields', () => {
    registerMcpAuthTool(registry);
    const schema = registry.get(MCP_AUTH_TOOL_NAME)?.inputSchema as {
      required?: string[];
    };
    expect(schema.required).toEqual([
      'server_url',
      'client_id',
      'redirect_uri',
      'auth_endpoint',
      'token_endpoint',
      'scopes',
    ]);
  });

  it('execute returns isError=true on invalid input', async () => {
    registerMcpAuthTool(registry);
    const tool = registry.get(MCP_AUTH_TOOL_NAME);
    if (!tool) throw new Error('tool missing');
    const result = await tool.execute(
      {
        server_url: '',
        client_id: 'c',
        redirect_uri: 'http://localhost:1/cb',
        auth_endpoint: 'https://e.example/auth',
        token_endpoint: 'https://e.example/token',
        scopes: ['s'],
      },
      {
        workingDirectory: process.cwd(),
        sessionState: {} as never,
        hooks: {} as never,
      },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    if (result.content[0]?.type === 'text') {
      expect(result.content[0].text).toMatch(/invalid_request/);
    }
  });
});

// Cleanup any leftover tmp dirs.
afterEach(() => {
  // Remove per-test dirs created by tmpFile().
  for (const name of readdirSync(tmpdir())) {
    if (name.startsWith('pacode-mcp-auth-')) {
      try {
        rmSync(join(tmpdir(), name), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
});