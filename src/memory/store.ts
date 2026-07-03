/**
 * Memory Store - File-based memory system
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  MemoryKey,
  MemoryBlock,
  MemoryType,
} from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';

export class MemoryStore {
  private memoryDir: string;
  private log: Logger;

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir ?? join(process.cwd(), '.paude', 'memory');
    this.log = new Logger({ prefix: 'MemoryStore' });
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!existsSync(this.memoryDir)) {
      mkdirSync(this.memoryDir, { recursive: true });
    }
  }

  private getPath(key: MemoryKey): string {
    return join(this.memoryDir, key.scope, key.category, `${key.id}.json`);
  }

  async read(key: MemoryKey): Promise<MemoryBlock | null> {
    const path = this.getPath(key);
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
    this.log.debug(`Wrote memory: ${key.id}`);
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

  async search(_query: string, _options?: { limit?: number; scope?: string }): Promise<MemoryBlock[]> {
    // Simplified implementation - returns empty array
    return [];
  }

  async delete(key: MemoryKey): Promise<void> {
    const path = this.getPath(key);
    if (existsSync(path)) {
      unlinkSync(path);
      this.log.debug(`Deleted memory: ${key.id}`);
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
export function getMemoryStore(): MemoryStore {
  if (!instance) instance = new MemoryStore();
  return instance;
}
