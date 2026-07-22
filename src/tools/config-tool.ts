/**
 * K2: ConfigTool — 薄封装 SettingsManager + resolveAppConfig（不新建配置系统）
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';
import {
  getSettingsManager,
  type PaCodeSettings,
  type SettingsManager,
} from '../pkg/settings/index.js';
import { resolveAppConfig } from '../pkg/app-config.js';

/** 允许 ConfigTool 写入的 settings 键（不含 hooks/mcp 整块） */
export const CONFIG_WRITABLE_KEYS = [
  'model',
  'apiKey',
  'baseUrl',
  'mode',
  'maxTokens',
  'temperature',
] as const;

export type ConfigWritableKey = (typeof CONFIG_WRITABLE_KEYS)[number];

function isWritableKey(key: string): key is ConfigWritableKey {
  return (CONFIG_WRITABLE_KEYS as readonly string[]).includes(key);
}

/** 脱敏 apiKey，避免工具结果泄漏 */
export function redactSettings(settings: PaCodeSettings): Record<string, unknown> {
  const out: Record<string, unknown> = { ...settings };
  if (typeof out.apiKey === 'string' && out.apiKey.length > 0) {
    out.apiKey = '(set)';
  }
  return out;
}

export function redactResolved(resolved: ReturnType<typeof resolveAppConfig>): Record<string, unknown> {
  return {
    model: resolved.model,
    apiKey: resolved.apiKey ? '(set)' : undefined,
    baseUrl: resolved.baseUrl,
    maxTokens: resolved.maxTokens,
    temperature: resolved.temperature,
    mode: resolved.mode,
    contextMaxTokens: resolved.contextMaxTokens,
    compactionThreshold: resolved.compactionThreshold,
    prefetch: resolved.prefetch,
    permissions: resolved.permissions,
  };
}

function coerceValue(key: ConfigWritableKey, raw: unknown): unknown {
  if (key === 'maxTokens' || key === 'temperature') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
    return n;
  }
  if (key === 'mode' || key === 'model' || key === 'apiKey' || key === 'baseUrl') {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new Error(`${key} must be a non-empty string`);
    }
    return raw.trim();
  }
  return raw;
}

export interface ConfigToolDeps {
  settingsManager?: SettingsManager;
}

export function registerConfigTool(
  registry: { register: (t: ToolDefinition) => void },
  deps: ConfigToolDeps = {}
): void {
  registry.register({
    name: 'ConfigTool',
    description:
      'Read/write PaCode settings (thin wrapper). Actions: get, set, list. Writes go to .paude/settings*.json layers.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set', 'list'],
          description: 'get | set | list (default get)',
        },
        key: {
          type: 'string',
          description: `Settings key. Writable: ${CONFIG_WRITABLE_KEYS.join(', ')}`,
        },
        value: {
          description: 'Value for set',
        },
        target: {
          type: 'string',
          enum: ['user', 'project', 'local'],
          description: 'Write target layer (default local)',
        },
      },
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const {
        action = 'get',
        key,
        value,
        target = 'local',
      } = input as {
        action?: 'get' | 'set' | 'list';
        key?: string;
        value?: unknown;
        target?: 'user' | 'project' | 'local';
      };

      const mgr = deps.settingsManager ?? getSettingsManager();

      if (action === 'list') {
        const resolved = resolveAppConfig({}, { settingsManager: mgr });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  writable_keys: CONFIG_WRITABLE_KEYS,
                  targets: ['user', 'project', 'local'],
                  resolved: redactResolved(resolved),
                  settings_merged: redactSettings(mgr.load()),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (action === 'get') {
        const resolved = resolveAppConfig({}, { settingsManager: mgr });
        const merged = mgr.load();
        if (!key) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    resolved: redactResolved(resolved),
                    settings_merged: redactSettings(merged),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
        const fromSettings = merged[key as keyof PaCodeSettings];
        const fromResolved = (redactResolved(resolved) as Record<string, unknown>)[key];
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  key,
                  settings: key === 'apiKey' && fromSettings ? '(set)' : fromSettings,
                  resolved: fromResolved,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // set
      if (!key || !isWritableKey(key)) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid or missing key. Writable: ${CONFIG_WRITABLE_KEYS.join(', ')}`,
            },
          ],
          isError: true,
        };
      }
      if (value === undefined) {
        return {
          content: [{ type: 'text', text: 'value required for set' }],
          isError: true,
        };
      }

      // apiKey 禁止写入可提交的 project 层（.paude/settings.json 可能进 git）
      if (key === 'apiKey' && target === 'project') {
        return {
          content: [
            {
              type: 'text',
              text:
                'apiKey cannot be written to project settings (commit/leak risk). ' +
                'Use target=user or target=local (.paude/settings.local.json is gitignored).',
            },
          ],
          isError: true,
        };
      }

      try {
        const coerced = coerceValue(key, value);
        const layer = mgr.mergeSet(key, coerced, target);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: true,
                  target,
                  key,
                  path: mgr.pathFor(target),
                  layer: redactSettings(layer),
                  resolved: redactResolved(resolveAppConfig({}, { settingsManager: mgr })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        };
      }
    },
  });
}
