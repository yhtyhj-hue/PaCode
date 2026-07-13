/**
 * Session Manager
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  SessionState,
  Message,
  ToolCall,
  CompactionRecord,
  PermissionMode,
  HookConfig,
} from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';

export class SessionManager {
  private sessionsDir: string;
  private currentSession: SessionState | null = null;
  private log: Logger;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? join(process.cwd(), '.paude', 'sessions');
    this.log = new Logger({ prefix: 'SessionManager' });
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  createSession(options: CreateSessionOptions = {}): SessionState {
    const sessionId = this.generateSessionId();
    const state: SessionState = {
      sessionId,
      messages: [],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: options.mode ?? PermissionMode.DEFAULT,
      hooks: options.hooks ?? { hooks: {} },
      compactionHistory: [],
    };
    this.currentSession = state;
    this.log.info(`Created session: ${sessionId}`);
    return state;
  }

  loadSession(sessionId: string): SessionState | null {
    const path = this.getSessionPath(sessionId);
    if (!existsSync(path)) {
      this.log.warn(`Session not found: ${sessionId}`);
      return null;
    }
    try {
      const content = readFileSync(path, 'utf-8');
      this.currentSession = JSON.parse(content) as SessionState;
      this.log.info(`Loaded session: ${sessionId}`);
      return this.currentSession;
    } catch (error) {
      this.log.error(`Failed to load session: ${sessionId}`, error);
      return null;
    }
  }

  saveSession(state?: SessionState): void {
    const session = state ?? this.currentSession;
    if (!session) throw new Error('No active session');
    const path = this.getSessionPath(session.sessionId);
    writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8');
    this.log.debug(`Saved session: ${session.sessionId}`);
  }

  getCurrentSession(): SessionState | null {
    return this.currentSession;
  }

  /** 恢复已有 session 为当前会话（用于 --resume） */
  restoreSession(state: SessionState): SessionState {
    this.currentSession = state;
    this.log.info(`Restored session: ${state.sessionId}`);
    return state;
  }

  getSessionsDir(): string {
    return this.sessionsDir;
  }

  addMessage(state: SessionState, message: Message): void {
    state.messages.push({ ...message, timestamp: Date.now() });
  }

  getMessages(state: SessionState): Message[] {
    return [...state.messages];
  }

  addToolCall(state: SessionState, toolCall: ToolCall): void {
    state.toolCallHistory.push(toolCall);
  }

  getToolCallHistory(state: SessionState): ToolCall[] {
    return [...state.toolCallHistory];
  }

  addCompactionRecord(state: SessionState, record: Omit<CompactionRecord, 'timestamp'>): void {
    state.compactionHistory.push({ ...record, timestamp: Date.now() });
  }

  setPermissionMode(state: SessionState, mode: PermissionMode): void {
    state.mode = mode;
  }

  incrementRecoveryCount(state: SessionState): number {
    return ++state.maxOutputTokensRecoveryCount;
  }

  private generateSessionId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `${ts}-${rand}`;
  }

  private getSessionPath(sessionId: string): string {
    return join(this.sessionsDir, `session_${sessionId}.json`);
  }

  static generateProjectId(projectPath: string): string {
    return createHash('sha256').update(projectPath).digest('hex').substring(0, 12);
  }
}

interface CreateSessionOptions {
  mode?: PermissionMode;
  hooks?: HookConfig;
}
