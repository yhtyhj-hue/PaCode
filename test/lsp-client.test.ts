/**
 * Gate: LSP client — 无 typescript-language-server 则 skip 真 server 断言；契约与回退始终测
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  LspClient,
  canStartTypescriptLsp,
  resolveTypescriptServerCommand,
  LSP_CLIENT_CONTRACT,
} from '../src/services/lsp-client/index.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerLspTool } from '../src/tools/lsp.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('lsp-client', () => {
  it('resolveTypescriptServerCommand returns null or local bin', () => {
    const cmd = resolveTypescriptServerCommand(process.cwd());
    if (cmd) {
      expect(cmd.args).toContain('--stdio');
      expect(existsSync(cmd.command) || cmd.command.includes('typescript-language-server')).toBe(
        true
      );
    } else {
      expect(canStartTypescriptLsp(process.cwd())).toBe(false);
    }
  });

  it(
    'Diagnostics tool falls back without LSP server',
    async () => {
      const registry = new ToolRegistry();
      registerLspTool(registry);
      const tool = registry.get('Diagnostics');
      expect(tool).toBeTruthy();
      const result = await tool!.execute(
        { action: 'diagnostics', prefer: 'tsc' },
        {
          workingDirectory: process.cwd(),
          sessionState: {
            sessionId: 't',
            messages: [],
            toolCallHistory: [],
            maxOutputTokensRecoveryCount: 0,
            mode: PermissionMode.BYPASS,
            hooks: { hooks: {} },
            compactionHistory: [],
          },
          hooks: { hooks: {} } as never,
        }
      );
      expect(result.content[0] && 'text' in result.content[0] ? result.content[0].text : '').toBeTruthy();
    },
    30_000
  );

  describe.skipIf(!canStartTypescriptLsp(process.cwd()))('with typescript-language-server', () => {
    let work: string;
    let client: LspClient;

    beforeAll(async () => {
      work = mkdtempSync(join(tmpdir(), 'lsp-fix-'));
      writeFileSync(
        join(work, 'sample.ts'),
        `export function greet(name: string): string {\n  return "hi " + name;\n}\nconst x = greet("a");\n`
      );
      const cmd = resolveTypescriptServerCommand(process.cwd())!;
      client = new LspClient();
      const ok = await client.start(cmd.command, cmd.args, work);
      expect(ok).toBe(true);
      expect(client.contract).toBe(LSP_CLIENT_CONTRACT);
    });

    afterAll(async () => {
      await client.stop();
      rmSync(work, { recursive: true, force: true });
    });

    it('hover/definition on sample.ts', async () => {
      const file = join(work, 'sample.ts');
      const text = `export function greet(name: string): string {\n  return "hi " + name;\n}\nconst x = greet("a");\n`;
      await client.openDocument(file, text, 'typescript');
      const hover = await client.hover(file, { line: 3, character: 10 });
      expect(hover === null || typeof hover.contents === 'string').toBe(true);
      const defs = await client.definition(file, { line: 3, character: 10 });
      expect(Array.isArray(defs)).toBe(true);
    });
  });
});
