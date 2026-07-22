/**
 * Settings Manager — PaCode 自有路径（不读 ~/.claude）
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
    const root = projectDir ?? process.cwd();
    this.userPath = join(homedir(), '.paude', 'settings.json');
    this.projectPath = join(root, '.paude', 'settings.json');
    this.localPath = join(root, '.paude', 'settings.local.json');
  }

  load(): PaCodeSettings {
    const user = this.loadFile(this.userPath);
    const project = this.loadFile(this.projectPath);
    const local = this.loadFile(this.localPath);
    return { ...user, ...project, ...local };
  }

  /** 单层文件（ConfigTool set 合并用） */
  loadTarget(target: 'user' | 'project' | 'local'): PaCodeSettings {
    return this.loadFile(this.pathFor(target));
  }

  pathFor(target: 'user' | 'project' | 'local'): string {
    if (target === 'user') return this.userPath;
    if (target === 'project') return this.projectPath;
    return this.localPath;
  }

  save(settings: PaCodeSettings, target: 'user' | 'project' | 'local' = 'user'): void {
    const path = this.pathFor(target);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8');
    this.log.info(`Settings saved to ${path}`);
  }

  /** 合并单键写入目标层，不覆盖同文件其他键 */
  mergeSet(
    key: keyof PaCodeSettings,
    value: unknown,
    target: 'user' | 'project' | 'local' = 'local'
  ): PaCodeSettings {
    const current = this.loadTarget(target);
    const next: PaCodeSettings = { ...current, [key]: value };
    this.save(next, target);
    return next;
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

export function resetSettingsManager(): void {
  instance = null;
}
