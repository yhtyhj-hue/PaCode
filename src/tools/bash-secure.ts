/**
 * Bash Security — segment parsing, static analysis, output truncation
 */

import { exec } from 'node:child_process';

export const DEFAULT_BASH_MAX_OUTPUT_LINES = 500;

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+(-[^\s]*\s+)*-[^\s]*r[^\s]*f|rm\s+(-[^\s]*\s+)*-[^\s]*f[^\s]*r/, reason: 'Recursive force delete' },
  { pattern: /rm\s+-rf\s+\//, reason: 'Dangerous command detected' },
  { pattern: /DROP\s+TABLE/i, reason: 'SQL destructive operation' },
  { pattern: /git\s+push\s+(--force|-f)\b/i, reason: 'Force push blocked' },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'Fork bomb pattern' },
  { pattern: /\bdd\s+if=/i, reason: 'Disk overwrite pattern' },
  { pattern: /\bmkfs\./i, reason: 'Filesystem format blocked' },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: 'Direct disk write blocked' },
  { pattern: /\bchmod\s+(-[^\s]+\s+)*777\b/i, reason: 'Overly permissive chmod' },
];

const PIPE_TO_SHELL_PATTERNS = [
  /\|\s*(sh|bash|zsh|dash|python|python3|node|ruby|perl)\b/i,
  /\bcurl\b[^\n|]*\|\s*(sh|bash)/i,
  /\bwget\b[^\n|]*\|\s*(sh|bash)/i,
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
  /^wc\b/,
  /^file\b/,
  /^stat\b/,
  /^seq\b/,
];

const NETWORK_COMMANDS = [/^curl\b/, /^wget\b/, /^nc\b/, /^ssh\b/, /^scp\b/];

/** 禁止的 shell 元语法（全命令检查） */
const FORBIDDEN_CONSTRUCTS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\$\(/, reason: 'Command substitution ($(...)) not allowed' },
  { pattern: /`[^`]*`/, reason: 'Command substitution (backticks) not allowed' },
  { pattern: /<\([^)]+\)/, reason: 'Process substitution not allowed' },
  { pattern: />\s*\/dev\/(?!null|stdout|stderr|tty)/i, reason: 'Write to device blocked' },
];

export interface SecurityCheck {
  safe: boolean;
  reason?: string;
  category?: 'readonly' | 'destructive' | 'network' | 'unknown';
}

export interface BashSecurityConfig {
  maxOutputLines?: number;
  timeoutMs?: number;
}

export interface BashExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated?: boolean;
}

/** 按 | && || ; 分段（尊重引号，不做完整 shell 解析） */
export function parseShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  const push = (): void => {
    const trimmed = current.trim();
    if (trimmed) segments.push(trimmed);
    current = '';
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      current += ch;
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === '\n' || ch === '\r') {
        push();
        continue;
      }
      if (command.startsWith('&&', i)) {
        push();
        i += 1;
        continue;
      }
      if (command.startsWith('||', i)) {
        push();
        i += 1;
        continue;
      }
      if (ch === '|' || ch === ';') {
        push();
        continue;
      }
      if (ch === '&') {
        push();
        continue;
      }
    }

    current += ch;
  }

  push();
  return segments.length > 0 ? segments : [command.trim()].filter(Boolean);
}

/** 提取 segment 的基础命令名（忽略 env 前缀与路径） */
export function getSegmentBaseCommand(segment: string): string {
  let rest = segment.trim();

  // 跳过 env 前缀：VAR=val cmd ...
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(rest)) {
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) return '';
    rest = rest.slice(spaceIdx + 1).trim();
  }

  const match = rest.match(/^([^\s|;&]+)/);
  if (!match) return '';

  const token = match[1]!;
  const base = token.includes('/') ? (token.split('/').pop() ?? token) : token;
  return base.replace(/^\\+/, '');
}

/** 截断 stdout/stderr，避免超大输出撑爆上下文 */
export function truncateBashOutput(
  text: string,
  maxLines = DEFAULT_BASH_MAX_OUTPUT_LINES
): { text: string; truncated: boolean } {
  if (!text) return { text: '', truncated: false };

  const lines = text.split('\n');
  if (lines.length <= maxLines) return { text, truncated: false };

  const kept = lines.slice(0, maxLines);
  return {
    text:
      kept.join('\n') +
      `\n\n… [truncated ${lines.length - maxLines} lines; showing first ${maxLines}]`,
    truncated: true,
  };
}

/** 拒绝控制字符与换行 — 防止 normalize 与 shell 执行不一致 */
function hasForbiddenControlChars(command: string): boolean {
  for (let i = 0; i < command.length; i++) {
    const code = command.charCodeAt(i);
    if (code === 10 || code === 13 || code < 32 || code === 127) return true;
  }
  return false;
}

function normalizeForScan(command: string): string {
  return command.replace(/\s+/g, ' ').trim();
}

function checkSegment(segment: string): SecurityCheck | null {
  const normalized = normalizeForScan(segment);

  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      return { safe: false, reason, category: 'destructive' };
    }
  }

  for (const pattern of PIPE_TO_SHELL_PATTERNS) {
    if (pattern.test(normalized)) {
      return { safe: false, reason: 'Piping to shell interpreter blocked', category: 'destructive' };
    }
  }

  if (/;\s*rm\s+/i.test(normalized)) {
    return { safe: false, reason: 'Chained delete command blocked', category: 'destructive' };
  }

  const base = getSegmentBaseCommand(segment);
  if (!base) return null;

  for (const pattern of READONLY_COMMANDS) {
    if (pattern.test(base) || pattern.test(normalized)) {
      return { safe: true, category: 'readonly' };
    }
  }

  for (const pattern of NETWORK_COMMANDS) {
    if (pattern.test(base) || pattern.test(normalized)) {
      return { safe: true, category: 'network' };
    }
  }

  if (/^git\s+push\b/i.test(normalized)) {
    return { safe: false, reason: 'Git push requires confirmation', category: 'destructive' };
  }

  return null;
}

function checkPipelineSinks(segments: string[]): SecurityCheck | null {
  if (segments.length < 2) return null;

  const shellSinks = new Set(['sh', 'bash', 'zsh', 'dash', 'python', 'python3', 'node', 'ruby', 'perl']);
  for (let i = 1; i < segments.length; i++) {
    const base = getSegmentBaseCommand(segments[i]!).toLowerCase();
    if (shellSinks.has(base)) {
      return {
        safe: false,
        reason: 'Piping to shell interpreter blocked',
        category: 'destructive',
      };
    }
  }
  return null;
}

export function checkBashSecurity(command: string): SecurityCheck {
  const trimmed = command.trim();
  if (!trimmed) {
    return { safe: false, reason: 'Empty command', category: 'unknown' };
  }

  if (hasForbiddenControlChars(trimmed)) {
    return {
      safe: false,
      reason: 'Control characters or newlines not allowed',
      category: 'destructive',
    };
  }

  for (const { pattern, reason } of FORBIDDEN_CONSTRUCTS) {
    if (pattern.test(trimmed)) {
      return { safe: false, reason, category: 'destructive' };
    }
  }

  for (const pattern of PIPE_TO_SHELL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        safe: false,
        reason: 'Piping to shell interpreter blocked',
        category: 'destructive',
      };
    }
  }

  const segments = parseShellSegments(trimmed);
  const pipelineBlock = checkPipelineSinks(segments);
  if (pipelineBlock) return pipelineBlock;
  let sawReadonly = false;
  let sawNetwork = false;

  for (const segment of segments) {
    const result = checkSegment(segment);
    if (result && !result.safe) return result;
    if (result?.category === 'readonly') sawReadonly = true;
    if (result?.category === 'network') sawNetwork = true;
  }

  if (sawReadonly && segments.every((s) => checkSegment(s)?.category === 'readonly')) {
    return { safe: true, category: 'readonly' };
  }

  if (sawNetwork) {
    return { safe: true, category: 'network' };
  }

  return {
    safe: false,
    reason: 'Unrecognized command requires confirmation',
    category: 'unknown',
  };
}

export function createSecureBashExecutor(config: BashSecurityConfig = {}) {
  const timeoutMs = config.timeoutMs ?? 60000;
  const maxOutputLines = config.maxOutputLines ?? DEFAULT_BASH_MAX_OUTPUT_LINES;

  return function secureBash(command: string): Promise<BashExecutionResult> {
    return new Promise((resolve) => {
      const security = checkBashSecurity(command);
      if (!security.safe) {
        resolve({ stdout: '', stderr: security.reason ?? 'Blocked', exitCode: 1 });
        return;
      }

      exec(command, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        const out = truncateBashOutput(stdout ?? '', maxOutputLines);
        const errOut = truncateBashOutput(stderr ?? '', maxOutputLines);

        resolve({
          stdout: out.text,
          stderr: errOut.text,
          exitCode: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
          truncated: out.truncated || errOut.truncated,
        });
      });
    });
  };
}
