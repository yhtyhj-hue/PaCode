/**
 * Bash Security - Parser differential defense
 */

import { exec } from 'node:child_process';

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /rm\s+-rf\s+\*\s+(\/|\.)/,
  /DROP\s+TABLE/i,
  /git\s+push\s+--force/i,
  /curl\s+.*\|/i,
  /wget\s+.*\|/i,
  /;\s*rm\s+/i,
  /:(){ :|:& };:/,
];

const READONLY_COMMANDS = [
  /^ls\b/,
  /^pwd\b/,
  /^cat\b/,
  /^head\b/,
  /^tail\b/,
  /^grep\b/,
  /^find\b/,
  /^git\s+status\b/,
  /^git\s+diff\b/,
  /^git\s+log\b/,
  /^echo\b/,
  /^which\b/,
  /^whoami\b/,
];

export interface SecurityCheck {
  safe: boolean;
  reason?: string;
  category?: 'readonly' | 'destructive' | 'network' | 'unknown';
}

export function checkBashSecurity(command: string): SecurityCheck {
  const trimmed = command.trim();

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, reason: 'Dangerous command detected', category: 'destructive' };
    }
  }

  for (const pattern of READONLY_COMMANDS) {
    if (pattern.test(trimmed)) {
      return { safe: true, category: 'readonly' };
    }
  }

  if (/git\s+push/i.test(trimmed)) {
    return { safe: false, reason: 'Git push requires confirmation', category: 'destructive' };
  }

  return { safe: true, category: 'unknown' };
}

export function createSecureBashExecutor(timeoutMs = 60000) {
  return function secureBash(
    command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const security = checkBashSecurity(command);
      if (!security.safe) {
        resolve({ stdout: '', stderr: security.reason ?? 'Blocked', exitCode: 1 });
        return;
      }

      exec(command, { timeout: timeoutMs }, (err, stdout, stderr) => {
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: err?.code ?? 0,
        });
      });
    });
  };
}
