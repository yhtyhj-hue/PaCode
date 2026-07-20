/**
 * Minimal LSP client — JSON-RPC over stdio（优先 typescript-language-server）
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export {
  resolveLanguageServer,
  resolveTypescriptServerCommand,
  languageIdFromPath,
  canStartTypescriptLsp,
  type LspLanguageId,
  type LspServerCommand,
} from './resolve-server.js';

export const LSP_CLIENT_CONTRACT = 'lsp/v1-stdio' as const;

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspLocation {
  uri: string;
  range: { start: LspPosition; end: LspPosition };
}

export interface LspHoverResult {
  contents: string;
}

export interface LspDiagnostic {
  severity?: number;
  message: string;
  source?: string;
  range: { start: LspPosition; end: LspPosition };
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

export class LspClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = Buffer.alloc(0);
  private contentLength = -1;
  readonly contract = LSP_CLIENT_CONTRACT;

  /** 启动 language server；失败返回 false */
  async start(command: string, args: string[], cwd: string): Promise<boolean> {
    await this.stop();
    try {
      this.proc = spawn(command, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch {
      return false;
    }

    this.proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    this.proc.on('exit', () => {
      this.proc = null;
      for (const [, p] of this.pending) {
        p.reject(new Error('LSP process exited'));
      }
      this.pending.clear();
    });

    try {
      await this.request('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(cwd).href,
        capabilities: {
          textDocument: {
            hover: { contentFormat: ['plaintext', 'markdown'] },
            definition: { linkSupport: false },
            publishDiagnostics: {},
          },
        },
      });
      this.notify('initialized', {});
      return true;
    } catch {
      await this.stop();
      return false;
    }
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      this.notify('exit', undefined);
    } catch {
      /* ignore */
    }
    this.proc.kill('SIGTERM');
    this.proc = null;
    this.pending.clear();
    this.buffer = Buffer.alloc(0);
    this.contentLength = -1;
  }

  async openDocument(path: string, text: string, languageId = 'typescript'): Promise<void> {
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: pathToFileURL(path).href,
        languageId,
        version: 1,
        text,
      },
    });
  }

  async hover(path: string, position: LspPosition): Promise<LspHoverResult | null> {
    const result = await this.request('textDocument/hover', {
      textDocument: { uri: pathToFileURL(path).href },
      position,
    });
    if (!result || typeof result !== 'object') return null;
    const contents = (result as { contents?: unknown }).contents;
    return { contents: formatHoverContents(contents) };
  }

  async definition(path: string, position: LspPosition): Promise<LspLocation[]> {
    const result = await this.request('textDocument/definition', {
      textDocument: { uri: pathToFileURL(path).href },
      position,
    });
    return normalizeLocations(result);
  }

  async request(method: string, params: unknown): Promise<unknown> {
    if (!this.proc?.stdin) throw new Error('LSP not started');
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const msg = `Content-Length: ${Buffer.byteLength(payload, 'utf-8')}\r\n\r\n${payload}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin.write(msg, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP timeout: ${method}`));
        }
      }, 15_000);
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.proc?.stdin) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
    const msg = `Content-Length: ${Buffer.byteLength(payload, 'utf-8')}\r\n\r\n${payload}`;
    this.proc.stdin.write(msg);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.contentLength < 0) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const header = this.buffer.slice(0, headerEnd).toString('utf-8');
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) {
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }
        this.contentLength = Number.parseInt(m[1]!, 10);
        this.buffer = this.buffer.slice(headerEnd + 4);
      }
      if (this.buffer.length < this.contentLength) return;
      const body = this.buffer.slice(0, this.contentLength).toString('utf-8');
      this.buffer = this.buffer.slice(this.contentLength);
      this.contentLength = -1;
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string };
    try {
      msg = JSON.parse(body) as typeof msg;
    } catch {
      return;
    }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? 'LSP error'));
      else p.resolve(msg.result);
    }
  }
}

function formatHoverContents(contents: unknown): string {
  if (contents == null) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents.map((c) => formatHoverContents(c)).join('\n');
  }
  if (typeof contents === 'object' && contents !== null && 'value' in contents) {
    return String((contents as { value: string }).value);
  }
  return JSON.stringify(contents);
}

function normalizeLocations(result: unknown): LspLocation[] {
  if (!result) return [];
  const arr = Array.isArray(result) ? result : [result];
  const out: LspLocation[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const loc = item as LspLocation & { targetUri?: string; targetRange?: LspLocation['range'] };
    if (loc.uri && loc.range) out.push({ uri: loc.uri, range: loc.range });
    else if (loc.targetUri && loc.targetRange) {
      out.push({ uri: loc.targetUri, range: loc.targetRange });
    }
  }
  return out;
}
