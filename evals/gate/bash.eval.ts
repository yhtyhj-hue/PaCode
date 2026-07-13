/**
 * Gate eval: Bash 安全默认 deny
 */
import { describe, it, expect } from 'vitest';
import { checkBashSecurity } from '../../src/tools/bash-secure.js';

describe('eval:gate:bash', () => {
  it('unknown commands are denied', () => {
    expect(checkBashSecurity('python -c "1"').safe).toBe(false);
  });

  it('newline injection is denied', () => {
    expect(checkBashSecurity('ls\necho pwned').safe).toBe(false);
  });
});
