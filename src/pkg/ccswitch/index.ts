/**
 * CC-Switch Integration
 *
 * Connects to Claude Code Switch (ccswitch) for unified API provider management.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';

export interface Provider {
  name: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  active?: boolean;
}

export interface CCSwitchConfig {
  providers: Provider[];
  activeProvider?: string;
}

export class CCSwitchClient {
  private configPath: string;
  private config: CCSwitchConfig;

  constructor(configPath?: string) {
    this.configPath = configPath ?? join(homedir(), '.paude', 'providers.json');
    this.config = this.load();
  }

  private load(): CCSwitchConfig {
    if (existsSync(this.configPath)) {
      try {
        const content = readFileSync(this.configPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        // ignore
      }
    }
    return { providers: [] };
  }

  private save(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  list(): Provider[] {
    return this.config.providers;
  }

  getActive(): Provider | undefined {
    if (this.config.activeProvider) {
      return this.config.providers.find(p => p.name === this.config.activeProvider);
    }
    return this.config.providers.find(p => p.active);
  }

  addProvider(provider: Provider): void {
    const idx = this.config.providers.findIndex(p => p.name === provider.name);
    if (idx >= 0) {
      this.config.providers[idx] = provider;
    } else {
      this.config.providers.push(provider);
    }
    this.save();
  }

  switchTo(name: string): Provider | null {
    const provider = this.config.providers.find(p => p.name === name);
    if (!provider) return null;

    this.config.providers.forEach(p => { p.active = false; });
    provider.active = true;
    this.config.activeProvider = name;
    this.save();

    if (provider.apiKey) process.env['ANTHROPIC_API_KEY'] = provider.apiKey;
    if (provider.baseUrl) process.env['ANTHROPIC_BASE_URL'] = provider.baseUrl;
    if (provider.model) process.env['CLAUDE_MODEL'] = provider.model;

    return provider;
  }

  getCredentials(): { apiKey?: string; baseUrl?: string; model?: string } {
    const active = this.getActive();
    if (!active) {
      return { apiKey: process.env['ANTHROPIC_API_KEY'] };
    }
    return {
      apiKey: active.apiKey ?? process.env['ANTHROPIC_API_KEY'],
      baseUrl: active.baseUrl ?? process.env['ANTHROPIC_BASE_URL'],
      model: active.model ?? process.env['CLAUDE_MODEL'],
    };
  }

  importFromClaudeCode(): number {
    const claudeConfigPath = join(homedir(), '.claude', 'settings.json');
    if (!existsSync(claudeConfigPath)) return 0;

    try {
      const content = readFileSync(claudeConfigPath, 'utf-8');
      const settings = JSON.parse(content);
      let imported = 0;

      if (settings.env?.ANTHROPIC_API_KEY) {
        const name = settings.env.ANTHROPIC_MODEL || 'claude-code-default';
        this.addProvider({
          name,
          apiKey: settings.env.ANTHROPIC_API_KEY,
          baseUrl: settings.env.ANTHROPIC_BASE_URL,
          model: settings.env.ANTHROPIC_MODEL,
          active: true,
        });
        this.config.activeProvider = name;
        imported++;
      }

      this.save();
      return imported;
    } catch {
      return 0;
    }
  }

  async interactiveSwitch(): Promise<Provider | null> {
    const providers = this.list();
    if (providers.length === 0) {
      console.log(`\n${YELLOW}⚠  No providers configured${RESET}`);
      console.log(`${DIM}Add one: pacode cc-switch add <name> --api-key <key>${RESET}\n`);
      return null;
    }

    const active = this.getActive();
    console.log(`\n${CYAN}${BOLD}  Select Provider${RESET}\n`);

    providers.forEach((p, i) => {
      const isActive = active?.name === p.name;
      const marker = isActive ? `${GREEN}●${RESET}` : `${GRAY}○${RESET}`;
      const label = isActive ? `${BOLD}${p.name}${RESET}` : p.name;
      const model = p.model ? `${DIM}${p.model}${RESET}` : '';
      console.log(`  ${marker} ${CYAN}${i + 1}${RESET}) ${label} ${model}`);
    });

    console.log(`\n${DIM}Enter number (1-${providers.length}):${RESET} `);

    return new Promise((resolve) => {
      const readline = require('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.on('line', (input: string) => {
        const idx = parseInt(input.trim(), 10) - 1;
        rl.close();
        if (idx >= 0 && idx < providers.length) {
          const p = providers[idx];
          if (p) {
            const result = this.switchTo(p.name);
            console.log(`\n${GREEN}✓ Switched to ${p.name}${RESET}\n`);
            resolve(result);
            return;
          }
        }
        console.log(`${RED}Invalid selection${RESET}`);
        resolve(null);
      });
    });
  }
}

let instance: CCSwitchClient | null = null;
export function getCCSwitch(): CCSwitchClient {
  if (!instance) instance = new CCSwitchClient();
  return instance;
}
