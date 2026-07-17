/**
 * Voice STT — 外部管道（PACODE_STT_CMD），无内置 Whisper 权重
 */

import { spawn, type ChildProcess } from 'node:child_process';

export const VOICE_CONTRACT = 'voice/v1-stt-pipe' as const;

export type VoiceRuntimeStatus = 'available' | 'listening' | 'error' | 'stopped';

export interface VoiceStatusReport {
  contract: typeof VOICE_CONTRACT;
  status: VoiceRuntimeStatus;
  message: string;
  alternatives: string[];
  sttCmd?: string;
  error?: string;
  buddyNarration?: boolean;
}

type TranscriptHandler = (text: string) => void;

let child: ChildProcess | null = null;
let lastError: string | undefined;
let onTranscript: TranscriptHandler | null = null;
let buddyNarration = false;

export function resolveSttCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const cmd = env['PACODE_STT_CMD']?.trim();
  return cmd || undefined;
}

export function setVoiceTranscriptHandler(handler: TranscriptHandler | null): void {
  onTranscript = handler;
}

export function setBuddyNarration(enabled: boolean): void {
  buddyNarration = enabled;
}

export function isBuddyNarrationEnabled(): boolean {
  return buddyNarration;
}

/** Buddy 旁白：可选注入 system 提示片段 */
export function buddySystemHint(): string | null {
  if (!buddyNarration) return null;
  return 'Buddy narration is on: briefly narrate what you are about to do in one short sentence before tool use.';
}

export function getVoiceStatus(): VoiceStatusReport {
  const sttCmd = resolveSttCommand();
  if (lastError && !child) {
    return {
      contract: VOICE_CONTRACT,
      status: 'error',
      message: lastError,
      alternatives: [
        'Set PACODE_STT_CMD to a command that prints transcripts to stdout (one line per utterance)',
        'Example: PACODE_STT_CMD="cat /tmp/mock-stt.txt"',
      ],
      sttCmd,
      error: lastError,
      buddyNarration,
    };
  }
  if (child) {
    return {
      contract: VOICE_CONTRACT,
      status: 'listening',
      message: 'STT pipe is running; transcripts inject into the REPL input.',
      alternatives: ['/voice stop to halt', '/voice buddy on|off for narration hint'],
      sttCmd,
      buddyNarration,
    };
  }
  if (!sttCmd) {
    return {
      contract: VOICE_CONTRACT,
      status: 'available',
      message:
        'Voice pipe ready but PACODE_STT_CMD is unset. Configure an external STT command, then /voice start.',
      alternatives: [
        'export PACODE_STT_CMD=\'your-stt-cmd\'  # stdout lines → REPL',
        'Use AskUser / paste text if you do not need STT',
      ],
      buddyNarration,
    };
  }
  return {
    contract: VOICE_CONTRACT,
    status: 'stopped',
    message: 'STT configured; not listening. Use /voice start.',
    alternatives: ['/voice start', '/voice stop', '/voice status'],
    sttCmd,
    buddyNarration,
  };
}

export function formatVoiceStatus(report: VoiceStatusReport = getVoiceStatus()): string {
  return [
    `Voice status: ${report.status}`,
    report.message,
    report.sttCmd ? `sttCmd=${report.sttCmd}` : 'sttCmd=(unset)',
    `buddyNarration=${report.buddyNarration ? 'on' : 'off'}`,
    '',
    'Alternatives:',
    ...report.alternatives.map((a) => `- ${a}`),
    '',
    `contract=${report.contract}`,
  ].join('\n');
}

/** 启动 STT 子进程；stdout 按行回调 */
export function startVoiceListening(options: {
  command?: string;
  onLine?: TranscriptHandler;
} = {}): VoiceStatusReport {
  stopVoiceListening();
  lastError = undefined;
  const command = options.command ?? resolveSttCommand();
  if (!command) {
    lastError = 'PACODE_STT_CMD not set';
    return getVoiceStatus();
  }
  if (options.onLine) onTranscript = options.onLine;

  try {
    // shell:true 允许管道如 `rec | whisper`
    child = spawn(command, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    child = null;
    return getVoiceStatus();
  }

  let lineBuf = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    lineBuf += chunk.toString('utf-8');
    const parts = lineBuf.split(/\r?\n/);
    lineBuf = parts.pop() ?? '';
    for (const line of parts) {
      const t = line.trim();
      if (t) onTranscript?.(t);
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const t = chunk.toString('utf-8').trim();
    if (t) lastError = t.slice(0, 200);
  });
  child.on('exit', (code) => {
    child = null;
    if (code && code !== 0 && !lastError) {
      lastError = `STT process exited with code ${code}`;
    }
  });
  child.on('error', (err) => {
    lastError = err.message;
    child = null;
  });

  return getVoiceStatus();
}

export function stopVoiceListening(): VoiceStatusReport {
  if (child) {
    child.kill('SIGTERM');
    child = null;
  }
  return getVoiceStatus();
}

/** 测试辅助：重置模块状态 */
export function resetVoiceStateForTests(): void {
  stopVoiceListening();
  lastError = undefined;
  onTranscript = null;
  buddyNarration = false;
}
