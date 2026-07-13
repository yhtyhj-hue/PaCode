/**
 * Query Engine - Core agent loop
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  QueryRequest,
  QueryOptions,
  SessionState,
  ToolCall,
  ToolResult,
  StopReason,
  HookType,
  ToolContext,
} from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';
import { ContextAssembler } from '../context/assembler.js';
import { CompactionPipeline } from '../context/compaction.js';
import { ToolRegistry } from '../tools/registry.js';
import { PermissionSystem } from '../permission/system.js';
import { SessionManager } from '../session/manager.js';
import { HookRegistry } from '../hooks/registry.js';
import { responseContentToBlocks, serializeMessagesForApi } from './message-serializer.js';
import { executeToolCallsInOrder } from './tool-executor.js';
import { consumeModelStream, ModelStreamEvent, StreamEventLike } from './model-stream.js';
import { resolveAppConfig } from '../pkg/app-config.js';

export type PermissionPromptFn = (tool: ToolCall) => Promise<boolean>;

/** max_tokens 重试上限 */
export const MAX_OUTPUT_TOKEN_RECOVERY = 3;

export class QueryEngine {
  private client: Anthropic;
  private contextAssembler: ContextAssembler;
  private compactionPipeline: CompactionPipeline;
  private toolRegistry: ToolRegistry;
  private permissionSystem: PermissionSystem;
  private sessionManager: SessionManager;
  private hookRegistry: HookRegistry;
  private permissionPrompt: PermissionPromptFn;
  private contextMaxTokens: number;
  private log: Logger;

  constructor(options: QueryEngineOptions = {}) {
    const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    const baseURL = options.baseUrl ?? process.env['ANTHROPIC_BASE_URL'];
    this.client = options.anthropicClient ?? new Anthropic({ apiKey, baseURL });
    const appConfig = resolveAppConfig();
    this.contextMaxTokens = appConfig.contextMaxTokens;
    this.contextAssembler = options.contextAssembler ?? new ContextAssembler();
    this.compactionPipeline =
      options.compactionPipeline ??
      new CompactionPipeline({ threshold: appConfig.compactionThreshold });
    this.toolRegistry = options.toolRegistry ?? new ToolRegistry();
    this.permissionSystem =
      options.permissionSystem ??
      new PermissionSystem({
        rules: appConfig.permissions,
        getToolDefinition: (name) => this.toolRegistry.get(name),
      });
    this.sessionManager = options.sessionManager ?? new SessionManager();
    this.hookRegistry = options.hookRegistry ?? new HookRegistry();
    this.permissionPrompt = options.permissionPrompt ?? this.defaultPermissionPrompt.bind(this);
    this.log = new Logger({ prefix: 'QueryEngine' });
    this.log.info('QueryEngine initialized');
  }

  getHookRegistry(): HookRegistry {
    return this.hookRegistry;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /** 工具执行管线（含 Hook），供集成测试使用 */
  async executeToolCall(toolCall: ToolCall, state: SessionState): Promise<ToolResult> {
    return this.executeTool(toolCall, state);
  }

  async *query(
    request: QueryRequest,
    state: SessionState
  ): AsyncGenerator<QueryEvent, void, unknown> {
    const mode = request.mode ?? state.mode;
    let effectiveOptions: QueryOptions = { ...(request.options ?? {}) };

    this.log.debug('Starting query', { mode });

    while (true) {
      try {
        const context = await this.assembleContext(state, effectiveOptions);

        let response: Extract<ModelStreamEvent, { type: 'model_complete' }> | undefined;
        for await (const event of this.streamModel(context, effectiveOptions)) {
          if (event.type === 'content_block_delta') {
            yield event;
          } else if (event.type === 'model_complete') {
            response = event;
          }
        }

        if (!response) break;

        if (response.stopReason === 'end_turn') {
          // 持久化 assistant 回复，供 REPL 多轮对话使用
          const assistantBlocks = responseContentToBlocks(response.content);
          if (assistantBlocks.length > 0) {
            state.messages.push({
              role: 'assistant',
              content: assistantBlocks,
              timestamp: Date.now(),
            });
          }

          yield {
            type: 'message_stop',
            stopReason: response.stopReason,
            usage: response.usage
              ? {
                  inputTokens: response.usage.input_tokens,
                  outputTokens: response.usage.output_tokens,
                  totalTokens: response.usage.input_tokens + response.usage.output_tokens,
                }
              : undefined,
          };
          break;
        }

        if (response.stopReason === 'tool_use') {
          state.messages.push({
            role: 'assistant',
            content: responseContentToBlocks(response.content),
            timestamp: Date.now(),
          });

          const toolResultBlocks: Array<{
            type: 'tool_result';
            toolUseId: string;
            toolResult: ToolResult;
          }> = [];

          // 权限检查（串行，需用户确认）
          const resultById = new Map<string, ToolResult>();
          const approvedCalls: ToolCall[] = [];

          for (const toolCall of response.toolCalls) {
            yield { type: 'tool_use', tool: toolCall };

            const allowed = this.permissionSystem.check({ tool: toolCall, mode, context: state });

            if (!allowed.allowed) {
              resultById.set(toolCall.id, {
                content: [
                  { type: 'text', text: `Permission denied: ${allowed.reason ?? 'unknown'}` },
                ],
                isError: true,
              });
              continue;
            }

            if (allowed.requiresInteraction) {
              const confirmed = await this.permissionPrompt(toolCall);
              if (!confirmed) {
                resultById.set(toolCall.id, {
                  content: [{ type: 'text', text: 'User denied permission' }],
                  isError: true,
                });
                continue;
              }
            }

            approvedCalls.push(toolCall);
          }

          // concurrencySafe 工具并行执行
          const executed = await executeToolCallsInOrder({
            toolCalls: approvedCalls,
            getDefinition: (name) => this.toolRegistry.get(name),
            executeOne: (call) => this.executeTool(call, state),
          });

          for (const { toolCall, result } of executed) {
            resultById.set(toolCall.id, result);
          }

          for (const toolCall of response.toolCalls) {
            const result = resultById.get(toolCall.id)!;
            yield { type: 'tool_result', tool: toolCall, result };
            toolResultBlocks.push({
              type: 'tool_result',
              toolUseId: toolCall.id,
              toolResult: result,
            });
            this.sessionManager.addToolCall(state, toolCall);
          }

          state.messages.push({
            role: 'user',
            content: toolResultBlocks,
            timestamp: Date.now(),
          });
          continue;
        }

        if (response.stopReason === 'max_tokens') {
          const recoveryCount = this.sessionManager.incrementRecoveryCount(state);
          const partialBlocks = responseContentToBlocks(response.content);
          if (partialBlocks.length > 0) {
            state.messages.push({
              role: 'assistant',
              content: partialBlocks,
              timestamp: Date.now(),
            });
          }

          if (recoveryCount > MAX_OUTPUT_TOKEN_RECOVERY) {
            this.log.error('Max tokens recovery limit exceeded');
            yield {
              type: 'error',
              error: {
                code: 'MAX_TOKENS',
                message: `Output exceeded max_tokens after ${MAX_OUTPUT_TOKEN_RECOVERY} retries`,
              },
            };
            break;
          }

          const currentMax = effectiveOptions.maxTokens ?? 8192;
          effectiveOptions = {
            ...effectiveOptions,
            maxTokens: Math.min(Math.floor(currentMax * 1.5), 64000),
          };
          this.log.warn(`Max tokens reached, retry ${recoveryCount}/${MAX_OUTPUT_TOKEN_RECOVERY}`);
          continue;
        }
      } catch (error) {
        yield {
          type: 'error',
          error: {
            code: 'EXECUTION_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
        };
        break;
      }
    }

    this.sessionManager.saveSession(state);
    this.log.debug('Query completed');
  }

  private async assembleContext(state: SessionState, options: QueryOptions) {
    const context = await this.contextAssembler.assemble(state, {
      systemPrompt: options.systemPrompt,
      tools: this.toolRegistry.list(),
    });
    context.maxTokens = this.contextMaxTokens;
    return this.compactionPipeline.run(context);
  }

  private async *streamModel(
    context: Awaited<ReturnType<typeof this.assembleContext>>,
    options: QueryOptions
  ) {
    const tools = this.toolRegistry.list();
    const system = context.systemPrompt;
    const messages = serializeMessagesForApi(context.messages);

    const stream = this.client.messages.stream({
      model: options.model ?? 'claude-sonnet-4-0',
      max_tokens: Math.min(options.maxTokens ?? 8192, context.maxTokens),
      temperature: options.temperature ?? 0.7,
      system,
      messages,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })) as Anthropic.Messages.Tool[],
    });

    for await (const event of consumeModelStream(stream as AsyncIterable<StreamEventLike>)) {
      if (event.type === 'model_complete') {
        try {
          const finalMessage = await stream.finalMessage();
          if (finalMessage.usage) {
            yield {
              ...event,
              usage: {
                input_tokens: finalMessage.usage.input_tokens,
                output_tokens: finalMessage.usage.output_tokens,
              },
            };
            continue;
          }
        } catch {
          /* usage optional */
        }
      }
      yield event;
    }
  }

  private buildToolContext(toolCall: ToolCall, state: SessionState): ToolContext {
    return {
      workingDirectory: process.cwd(),
      sessionState: state,
      hooks: this.hookRegistry,
      currentTool: toolCall,
    };
  }

  private async executeTool(toolCall: ToolCall, state: SessionState): Promise<ToolResult> {
    const tool = this.toolRegistry.get(toolCall.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Tool not found: ${toolCall.name}` }],
        isError: true,
      };
    }

    const ctx = this.buildToolContext(toolCall, state);

    const preHooks = this.hookRegistry.findMatching(HookType.PRE_TOOL_USE, ctx);
    for (const hook of preHooks) {
      try {
        const result = await this.hookRegistry.execute(hook);
        const exitCode = result.exitCode ?? 0;
        if (result.blocked || exitCode === 2) {
          return {
            content: [{ type: 'text', text: `Tool execution blocked by hook: ${hook.name}` }],
            isError: true,
          };
        }
        if (exitCode !== 0) {
          const msg = result.stderr || `Hook ${hook.name} exited with code ${exitCode}`;
          if (process.env['PACODE_HOOK_FAIL_OPEN'] === '1') {
            this.log.warn(`PreToolUse hook non-zero exit (fail-open): ${msg}`);
            continue;
          }
          return {
            content: [{ type: 'text', text: `Tool blocked: PreToolUse hook failed: ${msg}` }],
            isError: true,
          };
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log.warn(`PreToolUse hook failed: ${msg}`);
        if (process.env['PACODE_HOOK_FAIL_OPEN'] === '1') {
          continue;
        }
        return {
          content: [{ type: 'text', text: `Tool blocked: PreToolUse hook failed: ${msg}` }],
          isError: true,
        };
      }
    }

    try {
      const result = await tool.execute(toolCall.input, ctx);

      const postHooks = this.hookRegistry.findMatching(HookType.POST_TOOL_USE, ctx);
      for (const hook of postHooks) {
        try {
          await this.hookRegistry.execute(hook);
        } catch (e) {
          this.log.warn(`PostToolUse hook failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      return result;
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }

  private async defaultPermissionPrompt(tool: ToolCall): Promise<boolean> {
    if (!process.stdin.isTTY) {
      if (process.env['PACODE_AUTO_APPROVE'] === '1') {
        this.log.info(`Non-TTY with PACODE_AUTO_APPROVE: allowing ${tool.name}`);
        return true;
      }
      this.log.warn(
        `Non-TTY environment: denying ${tool.name} (set PACODE_AUTO_APPROVE=1 to allow)`
      );
      return false;
    }

    return new Promise((resolve) => {
      this.log.warn(`Allow ${tool.name}? (y/n) [default: y]`);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);

      const onData = (key: Buffer) => {
        const char = key.toString();
        if (char === 'y' || char === 'Y' || char === '\r') {
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener('data', onData);
          resolve(true);
        } else if (char === 'n' || char === 'N' || char === '\u0003') {
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener('data', onData);
          resolve(false);
        }
      };

      stdin.on('data', onData);
    });
  }
}

export interface QueryEngineOptions {
  apiKey?: string;
  baseUrl?: string;
  anthropicClient?: Anthropic;
  toolRegistry?: ToolRegistry;
  hookRegistry?: HookRegistry;
  permissionSystem?: PermissionSystem;
  sessionManager?: SessionManager;
  contextAssembler?: ContextAssembler;
  compactionPipeline?: CompactionPipeline;
  permissionPrompt?: PermissionPromptFn;
}

interface QueryEvent {
  type:
    | 'content_block_delta'
    | 'tool_use'
    | 'tool_result'
    | 'content_block_stop'
    | 'message_stop'
    | 'error';
  delta?: { index: number; text: string };
  tool?: ToolCall;
  result?: ToolResult;
  stopReason?: StopReason;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  error?: { code: string; message: string };
}
