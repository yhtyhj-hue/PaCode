import { describe, it, expect } from 'vitest';
import { checkBashSecurity, createSecureBashExecutor } from '../src/tools/bash-secure.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerBashTool } from '../src/tools/bash.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('Bash Security', () => {
  it('blocks rm -rf /', () => {
    const check = checkBashSecurity('rm -rf /');
    expect(check.safe).toBe(false);
    expect(check.category).toBe('destructive');
  });

  it('blocks git push --force', () => {
    const check = checkBashSecurity('git push --force origin main');
    expect(check.safe).toBe(false);
  });

  it('blocks git push without force flag check path', () => {
    const check = checkBashSecurity('git push origin main');
    expect(check.safe).toBe(false);
    expect(check.reason).toContain('confirmation');
  });

  it('allows readonly commands', () => {
    expect(checkBashSecurity('ls -la').safe).toBe(true);
    expect(checkBashSecurity('pwd').category).toBe('readonly');
    expect(checkBashSecurity('git status').safe).toBe(true);
  });

  it('secure executor blocks dangerous commands without running them', async () => {
    const exec = createSecureBashExecutor();
    const result = await exec('rm -rf /');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Dangerous');
  });

  it('secure executor runs safe commands', async () => {
    const exec = createSecureBashExecutor();
    const result = await exec('echo pacode-ok');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('pacode-ok');
  });
});

describe('Bash Tool Integration', () => {
  it('uses DEFAULT permission mode instead of BYPASS', () => {
    const registry = new ToolRegistry();
    registerBashTool(registry);
    expect(registry.get('Bash')?.permissionMode).toBe(PermissionMode.DEFAULT);
  });

  it('blocks dangerous commands via Bash tool', async () => {
    const registry = new ToolRegistry();
    registerBashTool(registry);
    const result = await registry.execute(
      { id: '1', name: 'Bash', input: { command: 'rm -rf /' } },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Dangerous');
  });

  it('executes safe commands via Bash tool', async () => {
    const registry = new ToolRegistry();
    registerBashTool(registry);
    const result = await registry.execute(
      { id: '2', name: 'Bash', input: { command: 'echo hello-bash' } },
      { workingDirectory: process.cwd(), sessionState: {} as never, hooks: {} as never }
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text?.trim()).toBe('hello-bash');
  });
});
