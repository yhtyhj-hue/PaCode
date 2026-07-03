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
    this.client = new Anthropic({
      apiKey: options.apiKey ?? process.env['ANTHROPIC_API_KEY'],
    });
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
          yield { type: 'message_stop', stopReason: response.stopReason };
          break;
        }

        if (response.stopReason === 'tool_use') {
          for (const toolCall of response.toolCalls) {
            yield { type: 'tool_use', tool: toolCall };

            const allowed = this.permissionSystem.check({ tool: toolCall, mode, context: state });

            if (!allowed.allowed) {
              yield {
                type: 'tool_result',
                result: {
                  content: [
                    { type: 'text', text: `Permission denied: ${allowed.reason ?? 'unknown'}` },
                  ],
                  isError: true,
                },
              };
              continue;
            }

            const result = await this.executeTool(toolCall, state);
            yield { type: 'tool_result', result };

            state.messages.push({
              role: 'user',
              content: [{ type: 'tool_result', toolResult: result }],
              timestamp: Date.now(),
            });

            this.sessionManager.addToolCall(state, toolCall);
          }
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
    const messages = context.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: typeof m.content === 'string' ? m.content : '...',
    }));

    const stream = this.client.messages.stream({
      model: options.model ?? 'claude-sonnet-4-0',
      max_tokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0.7,
      system,
      messages: messages as any[],
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as any,
      })) as any[],
    });

    let stopReason: StopReason = 'end_turn';
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

      if (event.type === 'message_delta' && event.delta.stop_reason) {
        if (event.delta.stop_reason === 'tool_use') stopReason = 'tool_use';
        else if (event.delta.stop_reason === 'end_turn') stopReason = 'end_turn';
        else if (event.delta.stop_reason === 'max_tokens') stopReason = 'max_tokens';
      }
    }

    for (const block of content) {
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
      }
    }

    return { stopReason, content, toolCalls };
  }

  private async executeTool(toolCall: ToolCall, state: SessionState): Promise<ToolResult> {
    const tool = this.toolRegistry.get(toolCall.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Tool not found: ${toolCall.name}` }],
        isError: true,
      };
    }

    try {
      return await tool.execute(toolCall.input, {
        workingDirectory: process.cwd(),
        sessionState: state,
        hooks: this.hookRegistry,
      });
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }
}

interface QueryEngineOptions {
  apiKey?: string;
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
  error?: { code: string; message: string };
}
