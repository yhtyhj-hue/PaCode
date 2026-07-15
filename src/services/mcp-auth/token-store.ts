/**
 * Encrypted credential storage for MCP OAuth tokens.
 *
 * Design:
 *   - File: ~/.paude/mcp-auth.json
 *   - Mode: 0600 (refuses to start if mode is broader)
 *   - KDF: scryptSync(passphrase = machine fingerprint, salt = per-file)
 *   - Cipher: AES-256-GCM with 12-byte IV per entry
 *   - AAD: server_url + client_id (prevents ciphertext relocation)
 *
 * The "machine fingerprint" combines hostname, username, and the
 * user-level home directory path so the file is unreadable on another
 * host or another user account on the same host. This is not a
 * cryptographic secret (anyone with shell access can derive it), but
 * it raises the bar above plaintext and is the best we can do without
 * asking the user to type a passphrase.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, chmodSync, unlinkSync, renameSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';
import { homedir, hostname, userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import type {
  McpAuthSession,
  StoredCredentialSummary,
  TokenStore,
} from './types.js';

/** Layout version. Bump on incompatible format changes. */
const FILE_VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SCRYPT_N = 16384; // 2^14 — fast enough for cold start, slow enough to deter brute force

interface StoredEntry {
  v: number;
  salt: string; // base64
  iv: string; // base64
  tag: string; // base64
  ct: string; // base64
  aad: string;
  stored_at: number;
  has_refresh_token: boolean;
  scopes: string[];
}

interface OnDiskFile {
  version: number;
  entries: Record<string, StoredEntry>;
}

/**
 * Make the storage key. server_url + client_id uniquely identify a
 * credential pair; normalize the server_url to strip trailing slashes.
 */
export function makeKey(serverUrl: string, clientId: string): string {
  return `${serverUrl.replace(/\/+$/, '')}::${clientId}`;
}

/**
 * Derive a stable machine fingerprint. Combines username, hostname
 * and home directory path so the same file copied across machines
 * is unreadable.
 */
export function machineFingerprint(): string {
  const parts = [
    userInfo().username,
    hostname(),
    homedir(),
    process.platform,
    process.arch,
  ];
  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex');
}

/** Derive AES key from fingerprint + salt via scrypt. */
function deriveKey(salt: Buffer): Buffer {
  return scryptSync(machineFingerprint(), salt, KEY_BYTES, { N: SCRYPT_N });
}

function encryptEntry(
  session: McpAuthSession,
  aad: string,
  storedAt: number,
): StoredEntry {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const plaintext = Buffer.from(JSON.stringify(session), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: FILE_VERSION,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: enc.toString('base64'),
    aad,
    stored_at: storedAt,
    has_refresh_token: typeof session.refresh_token === 'string',
    scopes: session.scope ? session.scope.split(/\s+/).filter(Boolean) : [],
  };
}

function decryptEntry(entry: StoredEntry, aadOverride?: string): McpAuthSession {
  if (entry.v !== FILE_VERSION) {
    throw new Error(`unsupported entry version: ${entry.v}`);
  }
  const salt = Buffer.from(entry.salt, 'base64');
  const iv = Buffer.from(entry.iv, 'base64');
  const tag = Buffer.from(entry.tag, 'base64');
  const ct = Buffer.from(entry.ct, 'base64');
  const key = deriveKey(salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  // If an AAD override is provided (load-time), use it. This binds
  // decryption to the lookup key, preventing ciphertext relocation
  // across entries.
  decipher.setAAD(Buffer.from(aadOverride ?? entry.aad, 'utf8'));
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  const obj = JSON.parse(dec.toString('utf8')) as McpAuthSession;
  return obj;
}

/** Create the storage directory if missing, ensuring 0700 perms. */
function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    // Tighten existing dir perms too.
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* non-fatal: filesystem may not support chmod (e.g. windows tests) */
    }
  }
}

/**
 * Fail loudly if file mode is broader than 0600. We never want
 * plaintext-equivalent material to be group/world readable.
 */
function assertStrictMode(filePath: string): void {
  const st = statSync(filePath);
  // S_IFREG = 0o100000, mask 0o777 to extract perms.
  const mode = st.mode & 0o777;
  if (mode & 0o077) {
    throw new Error(
      `refusing to read ${filePath}: mode 0o${mode.toString(8)} is broader than 0600`,
    );
  }
}

/** Write atomically: write to temp file then rename. */
function writeAtomic(filePath: string, data: string): void {
  ensureDir(filePath);
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  // Best-effort atomic rename (POSIX guarantees atomicity; on Windows
  // this is the closest we can get without a hard link).
  renameSync(tmp, filePath);
}

function readJsonFile(filePath: string): OnDiskFile {
  if (!existsSync(filePath)) {
    return { version: FILE_VERSION, entries: {} };
  }
  assertStrictMode(filePath);
  const text = readFileSync(filePath, 'utf8');
  if (text.trim().length === 0) {
    return { version: FILE_VERSION, entries: {} };
  }
  const parsed = JSON.parse(text) as OnDiskFile;
  if (!parsed || typeof parsed !== 'object' || !parsed.entries) {
    throw new Error('corrupted token store: missing entries');
  }
  return parsed;
}

function writeJsonFile(filePath: string, data: OnDiskFile): void {
  writeAtomic(filePath, JSON.stringify(data, null, 2));
}

export interface FileTokenStoreOptions {
  /** Override the default `~/.paude/mcp-auth.json` location. */
  filePath?: string;
}

/**
 * Create a TokenStore backed by an encrypted JSON file on disk.
 */
export function createFileTokenStore(opts: FileTokenStoreOptions = {}): TokenStore {
  const filePath = opts.filePath ?? join(homedir(), '.paude', 'mcp-auth.json');

  return {
    path() {
      return filePath;
    },

    async save(session: McpAuthSession): Promise<void> {
      const key = makeKey(session.server_url, session.client_id);
      const aad = key;
      const storedAt = Date.now();
      const entry = encryptEntry(session, aad, storedAt);
      const file = readJsonFile(filePath);
      file.entries[key] = entry;
      writeJsonFile(filePath, file);
    },

    async load(serverUrl: string, clientId: string): Promise<McpAuthSession | null> {
      if (!existsSync(filePath)) return null;
      const file = readJsonFile(filePath);
      const key = makeKey(serverUrl, clientId);
      const entry = file.entries[key];
      if (!entry) return null;
      try {
        // Re-derive the AAD from the lookup key, NOT from
        // `entry.aad`. The stored AAD field is just a record of what
        // was originally bound; the load-time AAD is what proves the
        // entry was filed under this exact (server_url, client_id).
        return decryptEntry(entry, key);
      } catch (e) {
        // Refuse to surface a tampered / corrupted entry; do not throw
        // silently — surface the error to the caller.
        throw new Error(
          `failed to decrypt token for ${serverUrl}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },

    async remove(serverUrl: string, clientId: string): Promise<void> {
      if (!existsSync(filePath)) return;
      const file = readJsonFile(filePath);
      const key = makeKey(serverUrl, clientId);
      if (key in file.entries) {
        delete file.entries[key];
        writeJsonFile(filePath, file);
      }
    },

    async list(): Promise<StoredCredentialSummary[]> {
      if (!existsSync(filePath)) return [];
      const file = readJsonFile(filePath);
      const out: StoredCredentialSummary[] = [];
      for (const [k, entry] of Object.entries(file.entries)) {
        const parts = k.split('::');
        const server_url = parts[0] ?? '';
        const client_id = parts[1] ?? '';
        // Decrypt just to read expires_at; use a try/catch so a bad
        // entry doesn't poison the list.
        try {
          const s = decryptEntry(entry);
          out.push({
            server_url,
            client_id,
            expires_at: s.expires_at,
            has_refresh_token: entry.has_refresh_token,
            scopes: entry.scopes,
            stored_at: entry.stored_at,
          });
        } catch {
          out.push({
            server_url,
            client_id,
            expires_at: 0,
            has_refresh_token: entry.has_refresh_token,
            scopes: entry.scopes,
            stored_at: entry.stored_at,
          });
        }
      }
      return out;
    },
  };
}

/** Test helper: forcibly delete the storage file. */
export function deleteStoreFile(filePath: string): void {
  if (existsSync(filePath)) unlinkSync(filePath);
}