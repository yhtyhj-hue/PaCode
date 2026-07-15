/**
 * Config Loader
 *
 * Configuration management for PaCode.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { PermissionMode } from '../types.js';

// ============================================================================
// Config Schemas
// ============================================================================

export const HookSchema = z.object({
  name: z.string(),
  type: z.enum([
    'PreToolUse',
    'PostToolUse',
    'SessionStart',
    'SessionStop',
    'Notification',
    'SubagentStop',
  ]),
  command: z.union([z.string(), z.array(z.string())]),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  matcher: z.object({
    tool: z.string().optional(),
    pattern: z.string().optional(),
  }).optional(),
});

export const PaudeConfigSchema = z.object({
  version: z.string().default('1.0.0'),

  // Model settings
  model: z.object({
    provider: z.enum(['anthropic', 'openai', 'local']).default('anthropic'),
    model: z.string().default('claude-sonnet-4-5'),
    maxTokens: z.number().default(8192),
    temperature: z.number().default(0.7),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
  }).default({}),

  // Permission settings
  permission: z.object({
    mode: z.nativeEnum(PermissionMode).default(PermissionMode.DEFAULT),
    allowBypass: z.boolean().default(false),
  }).default({}),

  // Context settings
  context: z.object({
    maxTokens: z.number().default(200000),
    compactionThreshold: z.number().default(0.83),
  }).default({}),

  // Hooks
  hooks: z.object({
    hooks: z.record(z.string(), z.array(HookSchema)).optional(),
  }).default({}),

  // MCP servers
  mcpServers: z.record(z.object({
    type: z.enum(['stdio', 'sse', 'http', 'websocket']),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    env: z.record(z.string()).optional(),
  })).optional(),

  // Project settings
  project: z.object({
    claudeMdPath: z.string().optional(),
    rulesPath: z.string().optional(),
    memoryPath: z.string().optional(),
  }).default({}),
});

export type PaudeConfig = z.infer<typeof PaudeConfigSchema>;

// ============================================================================
// Config Loader
// ============================================================================

let cachedConfig: PaudeConfig | null = null;

export function loadConfig(configPath?: string): PaudeConfig {
  if (!configPath && cachedConfig) {
    return cachedConfig;
  }

  const path = configPath ?? findConfigPath();

  if (!path) {
    const defaults = PaudeConfigSchema.parse({});
    if (!configPath) cachedConfig = defaults;
    return defaults;
  }

  try {
    const content = readFileSync(path, 'utf-8');
    const parsed = path.endsWith('.json')
      ? JSON.parse(content)
      : parseYaml(content);

    const config = PaudeConfigSchema.parse(parsed);
    if (!configPath) cachedConfig = config;
    return config;
  } catch (error) {
    throw new Error(`Failed to load config from ${path}: ${error}`);
  }
}

export function findConfigPath(): string | null {
  const searchPaths = [
    '.paude/config.json',
    '.paude/config.yaml',
    '.paude/config.yml',
    '.pauderc.json',
    '.pauderc',
    'paude.config.json',
  ];

  const cwd = process.cwd();

  for (const name of searchPaths) {
    const path = resolve(cwd, name);
    try {
      readFileSync(path, 'utf-8');
      return path;
    } catch {
      // Continue searching
    }
  }

  return null;
}

function parseYaml(content: string): unknown {
  // Simple YAML parser for basic key-value configs
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }
  }

  return result;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
