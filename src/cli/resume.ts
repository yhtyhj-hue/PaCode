/**
 * Session Resume & Continue
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SessionState, PermissionMode } from '../pkg/types.js';

export class SessionResume {
  private sessionsDirs: string[];

  constructor(sessionsDir?: string | string[]) {
    if (sessionsDir) {
      this.sessionsDirs = Array.isArray(sessionsDir) ? sessionsDir : [sessionsDir];
    } else {
      this.sessionsDirs = [
        join(process.cwd(), '.paude', 'sessions'),
        join(homedir(), '.paude', 'sessions'),
      ];
    }
  }

  list(): SessionInfo[] {
    const byId = new Map<string, SessionInfo>();

    for (const dir of this.sessionsDirs) {
      if (!existsSync(dir)) continue;

      for (const f of readdirSync(dir)) {
        if (!f.startsWith('session_') || !f.endsWith('.json')) continue;

        const path = join(dir, f);
        try {
          const content = readFileSync(path, 'utf-8');
          const session = JSON.parse(content) as SessionState;
          const stat = statSync(path);
          const info: SessionInfo = {
            id: session.sessionId,
            file: path,
            modified: stat.mtime,
            messageCount: session.messages.length,
            mode: session.mode,
          };

          const existing = byId.get(session.sessionId);
          if (!existing || info.modified > existing.modified) {
            byId.set(session.sessionId, info);
          }
        } catch {
          /* skip corrupt */
        }
      }
    }

    return Array.from(byId.values()).sort(
      (a, b) => b.modified.getTime() - a.modified.getTime()
    );
  }

  getLatest(): SessionInfo | null {
    const sessions = this.list();
    return sessions.length > 0 ? sessions[0]! : null;
  }

  load(id: string): SessionState | null {
    for (const dir of this.sessionsDirs) {
      const path = join(dir, `session_${id}.json`);
      if (!existsSync(path)) continue;
      try {
        return JSON.parse(readFileSync(path, 'utf-8')) as SessionState;
      } catch {
        return null;
      }
    }
    return null;
  }

  loadFromFile(filePath: string): SessionState | null {
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as SessionState;
    } catch {
      return null;
    }
  }
}

export interface SessionInfo {
  id: string;
  file: string;
  modified: Date;
  messageCount: number;
  mode: PermissionMode;
}

let instance: SessionResume | null = null;
export function getSessionResume(sessionsDir?: string | string[]): SessionResume {
  if (!instance || sessionsDir) {
    instance = new SessionResume(sessionsDir);
  }
  return instance;
}

export function resetSessionResume(): void {
  instance = null;
}
