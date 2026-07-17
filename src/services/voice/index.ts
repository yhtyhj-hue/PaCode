/**
 * J4: Voice / Buddy — 产品面延期；状态契约对标 Bridge
 */

export const VOICE_CONTRACT = 'voice/v0' as const;

export type VoiceStatus = 'unavailable' | 'deferred';

export interface VoiceStatusReport {
  contract: typeof VOICE_CONTRACT;
  status: VoiceStatus;
  message: string;
  alternatives: string[];
}

/** Voice/Buddy 尚未实现；引导用 AskUser / TTY 确认 */
export function getVoiceStatus(): VoiceStatusReport {
  return {
    contract: VOICE_CONTRACT,
    status: 'deferred',
    message:
      'Voice / Buddy are not implemented (ROADMAP J4 deferred product surface).',
    alternatives: [
      'Use AskUser tool for structured questions in the REPL',
      'Use confirm prompts (y/n) for permission decisions',
      'Pipe STT yourself and paste text into the REPL if needed',
    ],
  };
}

export function formatVoiceStatus(report: VoiceStatusReport = getVoiceStatus()): string {
  return [
    `Voice status: ${report.status}`,
    report.message,
    '',
    'Alternatives:',
    ...report.alternatives.map((a) => `- ${a}`),
    '',
    `contract=${report.contract}`,
  ].join('\n');
}
