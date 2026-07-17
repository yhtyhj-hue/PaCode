/**
 * Gate: Voice STT pipe with mock command (no mic)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VOICE_CONTRACT,
  getVoiceStatus,
  startVoiceListening,
  stopVoiceListening,
  resetVoiceStateForTests,
  setBuddyNarration,
  buddySystemHint,
} from '../src/services/voice/index.js';

describe('voice STT pipe', () => {
  let dir: string;

  beforeEach(() => {
    resetVoiceStateForTests();
    dir = mkdtempSync(join(tmpdir(), 'voice-'));
  });

  afterEach(() => {
    resetVoiceStateForTests();
    rmSync(dir, { recursive: true, force: true });
    delete process.env['PACODE_STT_CMD'];
  });

  it('status available when PACODE_STT_CMD unset', () => {
    const s = getVoiceStatus();
    expect(s.contract).toBe(VOICE_CONTRACT);
    expect(s.status).toBe('available');
  });

  it('start with mock cat command delivers transcript lines', async () => {
    const file = join(dir, 'utterance.txt');
    writeFileSync(file, 'hello from stt\n');
    // 用 shell cat；短暂进程结束后 status 可能为 stopped/error，但回调应收到行
    const lines: string[] = [];
    process.env['PACODE_STT_CMD'] = `cat "${file}"`;
    const report = startVoiceListening({
      onLine: (t) => lines.push(t),
    });
    expect(['listening', 'stopped', 'available', 'error']).toContain(report.status);

    await new Promise((r) => setTimeout(r, 200));
    expect(lines).toContain('hello from stt');
    stopVoiceListening();
  });

  it('buddy narration toggles system hint', () => {
    expect(buddySystemHint()).toBeNull();
    setBuddyNarration(true);
    expect(buddySystemHint()).toMatch(/Buddy narration/);
  });
});
