/**
 * Plugins System
 *
 * Plugin loader and manager.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger } from '../pkg/logger/index.js';

export interface Plugin {
  name: string;
  version: string;
  description: string;
  commands?: string[];
  agents?: string[];
  hooks?: Record<string, unknown>;
  tools?: string[];
}

export class PluginManager {
  private log: Logger;
  private pluginsDir: string;
  private plugins: Map<string, Plugin> = new Map();

  constructor(pluginsDir?: string) {
    this.log = new Logger({ prefix: 'PluginManager' });
    this.pluginsDir = pluginsDir ?? 'plugins';
  }

  async loadAll(): Promise<Map<string, Plugin>> {
    const basePath = resolve(process.cwd(), this.pluginsDir);

    if (!existsSync(basePath)) {
      this.log.debug(`Plugins directory not found: ${basePath}`);
      return this.plugins;
    }

    try {
      const entries = readdirSync(basePath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginPath = join(basePath, entry.name);
          const plugin = await this.loadPlugin(entry.name, pluginPath);
          if (plugin) {
            this.plugins.set(plugin.name, plugin);
          }
        }
      }

      this.log.info(`Loaded ${this.plugins.size} plugins`);
    } catch (error) {
      this.log.error('Failed to load plugins:', error);
    }

    return this.plugins;
  }

  private async loadPlugin(name: string, path: string): Promise<Plugin | null> {
    const manifestPath = join(path, 'plugin.json');

    if (!existsSync(manifestPath)) {
      this.log.warn(`Plugin ${name} has no manifest`);
      return null;
    }

    try {
      const content = readFileSync(manifestPath, 'utf-8');
      const plugin = JSON.parse(content) as Plugin;
      this.log.debug(`Loaded plugin: ${plugin.name}@${plugin.version}`);
      return plugin;
    } catch (error) {
      this.log.error(`Failed to load plugin ${name}:`, error);
      return null;
    }
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  list(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  getCommands(): string[] {
    const commands: string[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.commands) {
        commands.push(...plugin.commands);
      }
    }
    return commands;
  }
}
