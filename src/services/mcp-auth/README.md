# McpAuth Service

OAuth 2.0 (Authorization Code + PKCE) authentication for MCP servers.

Reference implementation aligned with Claude Code's `McpAuthTool` semantics.

## Public API

```ts
import {
  registerMcpAuthTool,
  MCP_AUTH_TOOL_NAME,
  McpAuthInput,
  McpAuthSession,
  createFileTokenStore,
  startMcpAuthFlow,
  refreshStoredToken,
  // Lower-level building blocks:
  generatePkcePair,
  generateState,
  buildAuthorizationUrl,
  startCallbackServer,
  exchangeAuthorizationCode,
  refreshAccessToken,
  validateMcpAuthInput,
  validateRedirectUri,
} from './src/services/mcp-auth/index.js';
```

## Tool

The registered tool is named `McpAuth` (see `MCP_AUTH_TOOL_NAME`).

| Property          | Value                                       |
| ----------------- | ------------------------------------------- |
| `concurrencySafe` | `false` (callback server is per-invocation) |
| `permissionMode`  | `PermissionMode.ACCEPT_EDITS`               |
| `inputSchema`     | JSON Schema with 6 required fields          |

### Required input fields

| Field            | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `server_url`     | MCP server URL (used as OAuth resource indicator)    |
| `client_id`      | OAuth client identifier                              |
| `redirect_uri`   | Loopback redirect URI registered for this client     |
| `auth_endpoint`  | Authorization endpoint (https, or localhost for dev) |
| `token_endpoint` | Token endpoint (https, or localhost for dev)         |
| `scopes`         | Non-empty array of scope strings                     |

## Flow

```
                +----------------------------+
                |  McpAuth tool invocation   |
                +-------------+--------------+
                              |
                  validateInput + validateRedirectUri
                              |
              +---------------v----------------+
              | generateState + generatePkce   |
              +---------------+----------------+
                              |
                  +-----------v-----------+
                  | startCallbackServer    |  (127.0.0.1:0)
                  +-----------+-----------+
                              |
                  +-----------v-----------+
                  | buildAuthorizationUrl  |
                  +-----------+-----------+
                              |
                  tool returns authorization_url
                              |
   <user opens browser, completes consent>
                              |
                  +-----------v-----------+
                  |  GET /callback arrives |
                  +-----------+-----------+
                              |
              +---------------v---------------+
              |  exchangeAuthorizationCode    |
              |    (POST token_endpoint)      |
              +---------------+---------------+
                              |
              +---------------v---------------+
              |  encrypt + save to disk       |  (0600, scrypt + AES-256-GCM)
              +---------------+---------------+
                              |
                  tool returns access_token metadata
```

## Cryptography

| Concern        | Choice                                                                                |
| -------------- | ------------------------------------------------------------------------------------- |
| PKCE method    | S256 (`code_challenge = base64url(sha256(code_verifier))`)                            |
| `code_verifier`| 32 random bytes → 43 base64url chars (RFC 7636 §4.1)                                  |
| `state`        | 16 random bytes → 22 base64url chars                                                  |
| Cipher         | AES-256-GCM, 12-byte IV per entry                                                     |
| KDF            | `scryptSync(fingerprint, salt, 32, N=16384)`                                          |
| AAD            | `server_url::client_id` (prevents ciphertext relocation across entries)               |
| File mode      | `0o600` (refuses to read or write a file with broader permissions)                    |
| File path      | `~/.paude/mcp-auth.json` (overridable via `FileTokenStoreOptions.filePath`)           |

The machine fingerprint is `sha256(username | hostname | homedir | platform | arch)`.
This raises the bar above plaintext for the offline-theft case without
requiring a user-supplied passphrase, which is unacceptable in a CLI tool.

## Threat model & defenses

| Threat                       | Defense                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| Authorization code theft     | PKCE (S256) ties the code to the verifier held only by us                                |
| CSRF on the redirect         | Cryptographically random `state` parameter validated against `expectedState`             |
| Open redirect / DNS rebind   | `validateRedirectUri` rejects anything other than `http://localhost|127.0.0.1|::1`        |
| Server exposed to LAN        | Server binds 127.0.0.1 only; any other host argument rejects outright                     |
| Token file leaked on disk    | AES-256-GCM, per-entry salt + IV, machine-fingerprint key                                |
| Token file chmod relaxed     | `assertStrictMode` refuses to read if mode is broader than 0600                          |
| Ciphertext relocation        | AAD binds ciphertext to `(server_url, client_id)`; moving it across entries fails       |
| Provider error swallowing    | RFC 6749 error codes mapped to typed `McpAuthErrorCategory`; raw body captured for debug |
| Callback hangs forever       | 60s timeout with explicit `timeout` error                                                |
| Same callback raced twice    | Tool marked `concurrencySafe: false`                                                     |

## Known limitations

- No interactive browser opening — the tool returns `authorization_url`
  and the host process decides how to surface it (open in browser, copy
  to clipboard, etc.).
- Machine fingerprint is not a cryptographic secret. A user with shell
  access on the same host can decrypt the file. To harden further, wrap
  `createFileTokenStore` with a key derived from a `passphrase` argument
  provided by the user.
- Token revocation with the provider (RFC 7009) is out of scope; we
  remove the entry locally via `TokenStore.remove()`.
- File integrity check is implicit via GCM tag; we do not use an
  additional MAC.

## File map

| File                  | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `types.ts`            | Public types                                           |
| `oauth-flow.ts`       | PKCE, state, URL build, token exchange, refresh        |
| `token-store.ts`      | Encrypted file-backed credential storage               |
| `callback-server.ts`  | Loopback HTTP server for the OAuth redirect            |
| `index.ts`            | Public API + `registerMcpAuthTool`                     |
| `README.md`           | This document                                          |

## Tests

`test/services/mcp-auth.test.ts` — 14 tests covering PKCE generation,
state verification, redirect_uri validation, file permissions,
encrypted round-trip, callback happy path, callback timeout,
authorization URL construction, error classification, refresh flow,
and tool registration.