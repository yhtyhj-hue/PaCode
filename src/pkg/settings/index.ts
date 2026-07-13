/**
 * Settings Manager
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { PermissionMode } from '../types.js';
import { Logger } from '../logger/index.js';

export interface PaCodeSettings {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  mode?: PermissionMode;
  maxTokens?: number;
  temperature?: number;
  env?: Record<string, string>;
  permissions?: { allow?: string[]; deny?: string[]; ask?: string[] };
  hooks?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
}

export class SettingsManager {
  private log: Logger;
  private userPath: string;
  private projectPath: string;
  private localPath: string;

  constructor(projectDir?: string) {
    this.log = new Logger({ prefix: 'Settings' });
    this.userPath = join(homedir(), '.claude', 'settings.json');
    this.projectPath = join(projectDir ?? process.cwd(), '.claude', 'settings.json');
    this.localPath = join(projectDir ?? process.cwd(), '.claude', 'settings.local.json');
  }

  load(): PaCodeSettings {
    const user = this.loadFile(this.userPath);
    const project = this.loadFile(this.projectPath);
    const local = this.loadFile(this.localPath);
    return { ...user, ...project, ...local };
  }

  save(settings: PaCodeSettings, target: 'user' | 'project' | 'local' = 'user'): void {
    const path = target === 'user' ? this.userPath : target === 'project' ? this.projectPath : this.localPath;
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8');
    this.log.info(`Settings saved to ${path}`);
  }

  private loadFile(path: string): PaCodeSettings {
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as PaCodeSettings;
    } catch {
      this.log.warn(`Failed to parse ${path}`);
      return {};
    }
  }
}

let instance: SettingsManager | null = null;
export function getSettingsManager(): SettingsManager {
  if (!instance) instance = new SettingsManager();
  return instance;
}
