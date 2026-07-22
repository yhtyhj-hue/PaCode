/**
 * Headless Agent API — 可编程调用 QueryEngine（对标 claude -p / SDK）
 */

import type Anthropic from '@anthropic-ai/sdk';
import { QueryEngine } from '../agent/engine.js';
import { SessionManager } from '../session/manager.js';
import { setupToolRegistry } from '../tools/setup.js';
import { getSubagentManager } from '../agent/subagent.js';
import { resolveAppConfig } from '../pkg/app-config.js';
import {
  PermissionMode,
  type ImageSource,
  type QueryEvent,
  type SessionState,
} from '../pkg/types.js';

export interface RunAgentOptions {
  message: string;
  mode?: PermissionMode | string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  authStyle?: import('../pkg/anthropic-client.js').ProviderAuthStyle;
  apiProtocol?: import('../pkg/ccswitch/presets.js').ProviderApiProtocol;
  maxTokens?: number;
  temperature?: number;
  images?: ImageSource[];
  workingDirectory?: string;
  /** 测试注入 mock Anthropic */
  anthropicClient?: Anthropic;
  /** 跳过 MCP/plugins（测试默认 true 以外的生产默认连 MCP） */
  connectMcp?: boolean;
  bootstrapPlugins?: boolean;
  onEvent?: (event: QueryEvent) => void;
}

export interface RunAgentResult {
  text: string;
  session: SessionState;
  hadError: boolean;
  errorMessage?: string;
}

/** 跑一轮 agent 并收集助手文本；不启 REPL */
export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const appConfig = resolveAppConfig({
    mode: options.mode,
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    authStyle: options.authStyle,
    apiProtocol: options.apiProtocol,
  });
  const apiKey = options.apiKey ?? appConfig.apiKey;
  const baseUrl = options.baseUrl ?? appConfig.baseUrl;
  const model = options.model ?? appConfig.model;
  const authStyle = options.authStyle ?? appConfig.authStyle;
  const apiProtocol = options.apiProtocol ?? appConfig.apiProtocol;

  const { registry, hookRegistry } = await setupToolRegistry({
    apiKey,
    baseUrl,
    model,
    connectMcp: options.connectMcp ?? true,
    bootstrapPlugins: options.bootstrapPlugins ?? true,
    subagentManager: getSubagentManager(),
  });

  const sessionManager = new SessionManager();
  const mode =
    typeof options.mode === 'string'
      ? ((options.mode as PermissionMode) ?? appConfig.mode)
      : (options.mode ?? appConfig.mode);
  const session = sessionManager.createSession({ mode });
  session.messages.push({
    role: 'user',
    content: options.message,
    timestamp: Date.now(),
  });

  const engine = new QueryEngine({
    apiKey,
    baseUrl,
    authStyle,
    apiProtocol,
    anthropicClient: options.anthropicClient,
    toolRegistry: registry,
    sessionManager,
    hookRegistry,
    workingDirectory: options.workingDirectory,
  });

  let text = '';
  let hadError = false;
  let errorMessage: string | undefined;

  for await (const event of engine.query(
    {
      message: options.message,
      images: options.images,
      options: {
        model,
        maxTokens: options.maxTokens ?? appConfig.maxTokens,
        temperature: options.temperature ?? appConfig.temperature,
      },
    },
    session
  )) {
    options.onEvent?.(event);
    if (event.type === 'content_block_delta' && event.delta?.text) {
      text += event.delta.text;
    } else if (event.type === 'error' && event.error) {
      hadError = true;
      errorMessage = event.error.message;
    }
  }

  sessionManager.saveSession(session);
  return { text, session, hadError, errorMessage };
}
