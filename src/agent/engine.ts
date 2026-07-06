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
} from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';
import { ContextAssembler } from '../context/assembler.js';
import { CompactionPipeline } from '../context/compaction.js';
import { ToolRegistry } from '../tools/registry.js';
import { PermissionSystem } from '../permission/system.js';
import { SessionManager } from '../session/manager.js';
import { HookRegistry } from '../hooks/registry.js';
import { responseContentToBlocks, serializeMessagesForApi } from './message-serializer.js';

export class QueryEngine {
  private client: Anthropic;
  private contextAssembler: ContextAssembler;
  private compactionPipeline: CompactionPipeline;
  private toolRegistry: ToolRegistry;
  private permissionSystem: PermissionSystem;
  private sessionManager: SessionManager;
  private hookRegistry: HookRegistry;
  private log: Logger;

  constructor(options: QueryEngineOptions = {}) {
    const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    const baseURL = options.baseUrl ?? process.env['ANTHROPIC_BASE_URL'];
    this.client = new Anthropic({ apiKey, baseURL });
    this.contextAssembler = new ContextAssembler();
    this.compactionPipeline = new CompactionPipeline();
    this.toolRegistry = new ToolRegistry();
    this.permissionSystem = new PermissionSystem();
    this.sessionManager = new SessionManager();
    this.hookRegistry = new HookRegistry();
    this.log = new Logger({ prefix: 'QueryEngine' });
    this.log.info('QueryEngine initialized');
  }

  async *query(
    request: QueryRequest,
    state: SessionState
  ): AsyncGenerator<QueryEvent, void, unknown> {
    const mode = request.mode ?? state.mode;
    const queryOptions = request.options ?? {};

    this.log.debug('Starting query', { mode });

    while (true) {
      try {
        const context = await this.assembleContext(state, queryOptions);
        const response = await this.callModel(context, queryOptions);

        if (response.stopReason === 'end_turn') {
          for (const block of response.content) {
            if (block.type === 'text') {
              yield { type: 'content_block_delta', delta: { index: 0, text: block.text ?? '' } };
            }
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
          // 先持久化 assistant 的 tool_use 消息，保证多轮工具调用上下文完整
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

          for (const toolCall of response.toolCalls) {
            yield { type: 'tool_use', tool: toolCall };

            const allowed = this.permissionSystem.check({ tool: toolCall, mode, context: state });

            let result: ToolResult;
            if (!allowed.allowed) {
              result = {
                content: [
                  { type: 'text', text: `Permission denied: ${allowed.reason ?? 'unknown'}` },
                ],
                isError: true,
              };
            } else if (allowed.requiresInteraction) {
              // Interactive permission prompt
              const confirmed = await this.promptForPermission(toolCall, mode);
              if (!confirmed) {
                result = {
                  content: [{ type: 'text', text: 'User denied permission' }],
                  isError: true,
                };
                yield { type: 'tool_result', tool: toolCall, result };
                toolResultBlocks.push({
                  type: 'tool_result',
                  toolUseId: toolCall.id,
                  toolResult: result,
                });
                this.sessionManager.addToolCall(state, toolCall);
                continue;
              }
              result = await this.executeTool(toolCall, state);
            } else {
              result = await this.executeTool(toolCall, state);
            }

            yield { type: 'tool_result', tool: toolCall, result };

            toolResultBlocks.push({
              type: 'tool_result',
              toolUseId: toolCall.id,
              toolResult: result,
            });

            this.sessionManager.addToolCall(state, toolCall);
          }

          // Anthropic API 要求同一轮的 tool_result 合并为一条 user 消息
          state.messages.push({
            role: 'user',
            content: toolResultBlocks,
            timestamp: Date.now(),
          });
          continue;
        }

        if (response.stopReason === 'max_tokens') {
          this.sessionManager.incrementRecoveryCount(state);
          this.log.warn('Max tokens reached, retrying');
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
    });
    return this.compactionPipeline.run(context);
  }

  private async callModel(
    context: Awaited<ReturnType<typeof this.assembleContext>>,
    options: QueryOptions
  ) {
    const tools = this.toolRegistry.list();

    const system = context.systemPrompt;
    const messages = serializeMessagesForApi(context.messages);

    const stream = this.client.messages.stream({
      model: options.model ?? 'claude-sonnet-4-0',
      max_tokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0.7,
      system,
      messages,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as any,
      })) as any[],
    });

    let stopReason: StopReason = 'end_turn';
    let usage: { input_tokens: number; output_tokens: number } | null = null;
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    > = [];
    const toolCalls: ToolCall[] = [];

    for await (const event of stream) {
      if (event.type === 'message_stop') {
        stopReason = 'end_turn';
        break;
      }

      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'text') {
          content.push({ type: 'text', text: '' });
        } else if (event.content_block.type === 'tool_use') {
          content.push({
            type: 'tool_use',
            id: event.content_block.id,
            name: event.content_block.name,
            input: {},
          });
        }
      }

      if (event.type === 'content_block_delta') {
        const last = content[content.length - 1];
        if (event.delta.type === 'text_delta' && last?.type === 'text') {
          last.text += event.delta.text;
        }
        if (event.delta.type === 'input_json_delta' && last?.type === 'tool_use') {
          Object.assign(last.input, JSON.parse(event.delta.partial_json));
        }
      }

      if (event.type === 'message_delta') {
        if (event.delta.stop_reason === 'tool_use') stopReason = 'tool_use';
        else if (event.delta.stop_reason === 'end_turn') stopReason = 'end_turn';
        else if (event.delta.stop_reason === 'max_tokens') stopReason = 'max_tokens';
      }

      // Capture usage info
      if (event.type === 'message_start' && event.message?.usage) {
        usage = {
          input_tokens: event.message.usage.input_tokens,
          output_tokens: event.message.usage.output_tokens,
        };
      }
    }

    for (const block of content) {
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
      }
    }

    // Get final usage from stream
    try {
      const finalMessage = await stream.finalMessage();
      if (finalMessage.usage) {
        usage = {
          input_tokens: finalMessage.usage.input_tokens,
          output_tokens: finalMessage.usage.output_tokens,
        };
      }
    } catch {
      // Ignore - usage will be null
    }

    return { stopReason, content, toolCalls, usage };
  }

  private async executeTool(toolCall: ToolCall, state: SessionState): Promise<ToolResult> {
    const tool = this.toolRegistry.get(toolCall.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Tool not found: ${toolCall.name}` }],
        isError: true,
      };
    }

    // PreToolUse hooks - can block execution (exit code 2)
    const preHooks = this.hookRegistry.findMatching('PreToolUse' as any, {
      workingDirectory: process.cwd(),
      sessionState: state,
      hooks: this.hookRegistry,
    } as any);

    for (const hook of preHooks) {
      try {
        const result = await this.hookRegistry.execute(hook);
        if (result.blocked || result.exitCode === 2) {
          return {
            content: [{ type: 'text', text: `Tool execution blocked by hook: ${hook.name}` }],
            isError: true,
          };
        }
      } catch (e) {
        this.log.warn(`PreToolUse hook failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    try {
      const result = await tool.execute(toolCall.input, {
        workingDirectory: process.cwd(),
        sessionState: state,
        hooks: this.hookRegistry,
      });

      // PostToolUse hooks
      const postHooks = this.hookRegistry.findMatching('PostToolUse' as any, {
        workingDirectory: process.cwd(),
        sessionState: state,
        hooks: this.hookRegistry,
      } as any);

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


  private async promptForPermission(tool: ToolCall, _mode: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.log.info(`Permission requested for ${tool.name}`);
      // In production: show interactive prompt
      // For now, default to allow
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
      this.log.warn(`Allow ${tool.name}? (y/n) [default: y]`);
    });
  }}

interface QueryEngineOptions {
  apiKey?: string;
  baseUrl?: string;
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
