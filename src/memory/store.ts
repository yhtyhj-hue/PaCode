/**
 * Memory Store - File-based memory system (user + project scopes)
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { MemoryKey, MemoryBlock, MemoryType } from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';
import {
  getProjectMemoryDir,
  getProjectMemoryRoot,
  getUserMemoryRoot,
  loadProjectMemoryMarkdown,
} from './project.js';

export interface MemoryStoreOptions {
  /** 用户级 memory 目录，默认 ~/.paude/memory */
  memoryDir?: string;
  /** 是否加载当前项目的 project memory */
  includeProject?: boolean;
  projectRoot?: string;
}

export class MemoryStore {
  private userMemoryDir: string;
  private projectMemoryDir: string | null;
  private projectRoot: string | null;
  private log: Logger;

  constructor(options?: MemoryStoreOptions | string) {
    if (typeof options === 'string') {
      this.userMemoryDir = options;
      this.projectMemoryDir = null;
      this.projectRoot = null;
    } else {
      this.userMemoryDir = options?.memoryDir ?? getUserMemoryRoot();
      this.projectRoot = options?.includeProject === false ? null : options?.projectRoot ?? null;
      this.projectMemoryDir =
        options?.includeProject === false ? null : getProjectMemoryDir(this.projectRoot ?? undefined);
    }
    this.log = new Logger({ prefix: 'MemoryStore' });
    this.ensureDirectory(this.userMemoryDir);
    if (this.projectMemoryDir) this.ensureDirectory(this.projectMemoryDir);
  }

  getUserMemoryDir(): string {
    return this.userMemoryDir;
  }

  getProjectMemoryDir(): string | null {
    return this.projectMemoryDir;
  }

  getProjectMemoryRoot(): string | null {
    return this.projectMemoryDir ? getProjectMemoryRoot(this.projectRoot ?? undefined) : null;
  }

  /** 项目 markdown + JSON memory，供 assembler 使用 */
  async formatForContext(limit = 10): Promise<string | null> {
    const blocks = await this.search('', { limit });
    const markdown = this.projectMemoryDir ? loadProjectMemoryMarkdown(this.projectRoot ?? undefined) : null;

    const parts: string[] = [];
    if (markdown) parts.push(markdown);
    if (blocks.length > 0) {
      parts.push(blocks.map((m) => `[${m.key.scope}/${m.key.category}] ${m.content}`).join('\n\n'));
    }
    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  private ensureDirectory(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private getBaseDir(scope: MemoryKey['scope']): string | null {
    if (scope === 'project') return this.projectMemoryDir;
    if (scope === 'user') return this.userMemoryDir;
    return this.userMemoryDir;
  }

  private getPath(key: MemoryKey): string {
    const base = this.getBaseDir(key.scope);
    if (!base) {
      throw new Error('Project memory is not enabled for this store');
    }
    return join(base, key.scope, key.category, `${key.id}.json`);
  }

  async read(key: MemoryKey): Promise<MemoryBlock | null> {
    let path: string;
    try {
      path = this.getPath(key);
    } catch {
      return null;
    }
    if (!existsSync(path)) return null;

    try {
      const content = readFileSync(path, 'utf-8');
      return JSON.parse(content) as MemoryBlock;
    } catch (error) {
      this.log.error(`Failed to read memory: ${key.id}`, error);
      return null;
    }
  }

  async write(key: MemoryKey, block: MemoryBlock): Promise<void> {
    const path = this.getPath(key);
    const dir = dirname(path);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    block.metadata.updated = Date.now();
    block.metadata.version++;

    writeFileSync(path, JSON.stringify(block, null, 2), 'utf-8');
    this.log.debug(`Wrote memory: ${key.scope}/${key.id}`);
  }

  async append(key: MemoryKey, content: string): Promise<void> {
    const existing = await this.read(key);
    if (existing) {
      existing.content += '\n' + content;
      existing.metadata.updated = Date.now();
      await this.write(key, existing);
    } else {
      await this.write(key, {
        key,
        type: this.inferType(key),
        content,
        metadata: { created: Date.now(), updated: Date.now(), tags: [], version: 1 },
      });
    }
  }

  /** 递归扫描 user + project memory 目录 */
  async search(
    query: string,
    options?: { limit?: number; scope?: MemoryKey['scope'] }
  ): Promise<MemoryBlock[]> {
    const limit = options?.limit ?? 20;
    const scopeFilter = options?.scope;
    const normalizedQuery = query.trim().toLowerCase();
    const results: MemoryBlock[] = [];

    const roots: Array<{ dir: string; defaultScope: MemoryKey['scope'] }> = [
      { dir: this.userMemoryDir, defaultScope: 'user' },
    ];
    if (this.projectMemoryDir) {
      roots.push({ dir: this.projectMemoryDir, defaultScope: 'project' });
    }

    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;

      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

        try {
          const block = JSON.parse(readFileSync(fullPath, 'utf-8')) as MemoryBlock;
          if (scopeFilter && block.key.scope !== scopeFilter) continue;

          if (normalizedQuery) {
            const haystack =
              `${block.key.scope} ${block.key.category} ${block.content} ${block.metadata.tags.join(' ')}`.toLowerCase();
            if (!haystack.includes(normalizedQuery)) continue;
          }

          results.push(block);
        } catch {
          /* skip corrupt files */
        }
      }
    };

    for (const root of roots) {
      if (scopeFilter && scopeFilter !== root.defaultScope) {
        continue;
      }
      walk(root.dir);
    }

    return results
      .sort((a, b) => b.metadata.updated - a.metadata.updated)
      .slice(0, limit);
  }

  async delete(key: MemoryKey): Promise<void> {
    let path: string;
    try {
      path = this.getPath(key);
    } catch {
      return;
    }
    if (existsSync(path)) {
      unlinkSync(path);
      this.log.debug(`Deleted memory: ${key.scope}/${key.id}`);
    }
  }

  private inferType(key: MemoryKey): MemoryType {
    if (key.category.includes('pref')) return MemoryType.PREFERENCE;
    if (key.category.includes('pattern')) return MemoryType.PATTERN;
    if (key.category.includes('decision')) return MemoryType.DECISION;
    if (key.category.includes('convention')) return MemoryType.CONVENTION;
    if (key.category.includes('codebase')) return MemoryType.CODEBASE_MAP;
    if (key.category.includes('arch')) return MemoryType.ARCHITECTURE;
    return MemoryType.PATTERN;
  }
}

let instance: MemoryStore | null = null;

export function getMemoryStore(options?: MemoryStoreOptions): MemoryStore {
  if (!instance || options) {
    instance = new MemoryStore(options);
  }
  return instance;
}

export function resetMemoryStore(): void {
  instance = null;
}

export { loadProjectMemoryMarkdown, computeProjectHash, getProjectMemoryRoot } from './project.js';
