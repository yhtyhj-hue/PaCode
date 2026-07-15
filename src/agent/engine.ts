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
  HookType,
  ToolContext,
  PermissionMode,
  QueryEvent,
} from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';
import { ContextAssembler } from '../context/assembler.js';
import { CompactionPipeline } from '../context/compaction.js';
import { ToolRegistry } from '../tools/registry.js';
import { PermissionSystem } from '../permission/system.js';
import { authorizePrefetchTool } from '../permission/prefetch-gate.js';
import { SessionManager } from '../session/manager.js';
import { HookRegistry } from '../hooks/registry.js';
import { responseContentToBlocks } from './message-serializer.js';
import { executeToolCallsInOrder } from './tool-executor.js';
import { consumeModelStream, ModelStreamEvent, StreamEventLike } from './model-stream.js';
import { withRetry } from './retry.js';
import { resolveAppConfig } from '../pkg/app-config.js';
import { getLatestUserText, requiresToolExecution } from './tool-intent.js';
import { compileMessagesForApi } from '../services/context-compiler/index.js';
import {
  resolveDagPlanWithHistory,
  formatDagResults,
  loadSkillContextForIntent,
  runIntentPrefetch,
  isParallelAgentsEnabled,
  runParallelAgentPrefetch,
} from '../services/agent-scheduler/index.js';

const DAG_PREFETCH_NOTE = 'Running intent DAG prefetch before model summary.';

/** 模型未调工具时的重试上限 */
export const MAX_TOOL_NUDGE_RETRIES = 1;

/** Agent 循环最大轮次，防止 tool_use 死循环 */
export const MAX_AGENT_TURNS = 50;

const TOOL_NUDGE_MESSAGE =
  'You must call at least one tool (Read, Glob, Grep, or Bash) before answering. Do not reply with text only.';

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
    let toolNudgeAttempts = 0;
    let turnCount = 0;
    let toolsUsedInQuery = false;
    let dagPrefetched = false;
    let deferredText: string[] = [];
    const pinnedIntent = request.message ?? getLatestUserText(state.messages);
    const shouldAbort = (): boolean => effectiveOptions.shouldAbort?.() ?? false;

    this.log.debug('Starting query', { mode });

    while (true) {
      if (shouldAbort()) {
        yield {
          type: 'error',
          error: { code: 'ABORTED', message: 'Query interrupted' },
        };
        break;
      }

      if (turnCount >= MAX_AGENT_TURNS) {
        yield {
          type: 'error',
          error: { code: 'MAX_TURNS', message: `Exceeded ${MAX_AGENT_TURNS} agent turns` },
        };
        break;
      }
      turnCount++;

      try {
        // 与 Claude Code 对齐：预取只加速上下文，不禁工具；模型可继续 Read/Grep 补洞
        const mustUseTools =
          requiresToolExecution(pinnedIntent) &&
          mode !== PermissionMode.PLAN &&
          !toolsUsedInQuery;

        const flushDeferredText = function* (): Generator<QueryEvent> {
          if (deferredText.length === 0) return;
          for (const text of deferredText) {
            yield { type: 'content_block_delta', delta: { index: 0, text } };
          }
          deferredText = [];
        };

        if (mustUseTools && effectiveOptions.toolChoice !== 'any') {
          effectiveOptions = { ...effectiveOptions, toolChoice: 'any' };
        }

        // L1 调度：intent DAG 预取（结果以 user 文本注入，不走 tool_result 协议）
        const dagPlan = !dagPrefetched
          ? resolveDagPlanWithHistory(pinnedIntent, state.messages)
          : null;
        if (dagPlan && mode !== PermissionMode.PLAN) {
          dagPrefetched = true;
          deferredText = [];
          toolsUsedInQuery = true;
          this.log.debug(DAG_PREFETCH_NOTE);

          const skillCtx = await loadSkillContextForIntent(dagPlan.intent);
          if (skillCtx.loadedNames.length > 0) {
            yield { type: 'skill_loaded', skills: skillCtx.loadedNames };
          }

          const useParallel =
            isParallelAgentsEnabled() &&
            (dagPlan.intent === 'inspect_project' ||
              dagPlan.intent === 'review_implementation' ||
              dagPlan.intent === 'code_audit');

          const queryId = `q_${state.sessionId}_${Date.now()}`;
          // L1 预取：与主循环同一 PermissionSystem；交互确认整批一次（并行安全）
          // 预填 batch tools 列表（基于 dagPlan 节点），保证 prompt 触发时列表已完整
          const prefetchBatchTools: ToolCall[] = dagPlan.nodes.map((node, i) => ({
            id: `dag_${node.id}_${i + 1}`,
            name: node.name,
            input: node.input,
          }));
          const prefetchBatchConfirm = {
            promise: null as Promise<boolean> | null,
            tools: prefetchBatchTools,
          };
          const prefetchExecute = async (call: ToolCall) => {
            const blocked = await authorizePrefetchTool(call, {
              permissionSystem: this.permissionSystem,
              mode,
              state,
              prompt: this.permissionPrompt,
              shouldAbort,
              batchConfirm: prefetchBatchConfirm,
            });
            if (blocked) return blocked;
            return this.executeTool(call, state);
          };
          const prefetchGen = useParallel
            ? runParallelAgentPrefetch(dagPlan.intent, prefetchExecute, queryId)
            : runIntentPrefetch(dagPlan, prefetchExecute);
          let runs: Array<{ tool: ToolCall; result: ToolResult }> = [];

          while (true) {
            const step = await prefetchGen.next();
            if (step.done) {
              runs = step.value ?? [];
              break;
            }
            if (shouldAbort()) {
              yield {
                type: 'error',
                error: { code: 'ABORTED', message: 'Query interrupted' },
              };
              break;
            }
            yield step.value;
          }

          if (shouldAbort()) break;

          if (runs.length > 0) {
            yield {
              type: 'prefetch_complete',
              prefetchTools: runs.map((r) => r.tool),
            };
            state.messages.push({
              role: 'user',
              content: formatDagResults(dagPlan.intent, runs, skillCtx.markdown),
              timestamp: Date.now(),
            });
            // 保留 tools：预取是加速，不是关掉 agent 循环（CC 式）
            effectiveOptions = {
              ...effectiveOptions,
              toolChoice: 'auto',
              suppressTools: false,
            };
          }

          if (shouldAbort()) {
            yield {
              type: 'error',
              error: { code: 'ABORTED', message: 'Query interrupted' },
            };
            break;
          }
        }

        const context = await this.assembleContext(state, effectiveOptions, mode);

        let response: Extract<ModelStreamEvent, { type: 'model_complete' }> | undefined;
        for await (const event of this.streamModel(context, effectiveOptions, mode)) {
          if (shouldAbort()) break;
          if (event.type === 'content_block_delta') {
            if (mustUseTools && !toolsUsedInQuery) {
              deferredText.push(event.delta.text);
            } else {
              yield* flushDeferredText();
              yield event;
            }
          } else if (event.type === 'model_complete') {
            response = event;
          }
        }

        if (shouldAbort()) {
          yield {
            type: 'error',
            error: { code: 'ABORTED', message: 'Query interrupted' },
          };
          break;
        }

        if (!response) break;

        if (response.stopReason === 'end_turn') {
          const noToolsUsed = response.toolCalls.length === 0;

          if (
            noToolsUsed &&
            mustUseTools &&
            !toolsUsedInQuery &&
            toolNudgeAttempts < MAX_TOOL_NUDGE_RETRIES
          ) {
            toolNudgeAttempts++;
            deferredText = [];
            this.log.warn('Model returned end_turn without tools; nudging tool use');
            state.messages.push({
              role: 'user',
              content: TOOL_NUDGE_MESSAGE,
              timestamp: Date.now(),
            });
            effectiveOptions = { ...effectiveOptions, toolChoice: 'any' };
            continue;
          }

          if (noToolsUsed && mustUseTools && !toolsUsedInQuery) {
            yield {
              type: 'error',
              error: {
                code: 'TOOL_REQUIRED',
                message: 'Model replied without calling required tools',
              },
            };
            break;
          }

          const assistantBlocks = responseContentToBlocks(response.content);
          if (assistantBlocks.length > 0) {
            state.messages.push({
              role: 'assistant',
              content: assistantBlocks,
              timestamp: Date.now(),
            });
          }

          yield* flushDeferredText();

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
          deferredText = [];
          toolsUsedInQuery = true;

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
            if (shouldAbort()) break;

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
              if (shouldAbort()) {
                resultById.set(toolCall.id, {
                  content: [{ type: 'text', text: 'Interrupted during permission prompt' }],
                  isError: true,
                });
                continue;
              }
              const confirmed = await this.permissionPrompt(toolCall);
              if (shouldAbort() || !confirmed) {
                resultById.set(toolCall.id, {
                  content: [
                    {
                      type: 'text',
                      text: shouldAbort()
                        ? 'Interrupted during permission prompt'
                        : 'User denied permission',
                    },
                  ],
                  isError: true,
                });
                continue;
              }
            }

            approvedCalls.push(toolCall);
          }

          if (shouldAbort()) {
            yield {
              type: 'error',
              error: { code: 'ABORTED', message: 'Query interrupted' },
            };
            break;
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

    if (!shouldAbort()) {
      this.sessionManager.saveSession(state);
    }
    this.log.debug('Query completed');
  }

  private async assembleContext(
    state: SessionState,
    options: QueryOptions,
    mode: PermissionMode
  ) {
    const tools =
      mode === PermissionMode.PLAN ? [] : this.toolRegistry.list();
    const context = await this.contextAssembler.assemble(state, {
      systemPrompt: options.systemPrompt,
      tools,
    });
    context.maxTokens = this.contextMaxTokens;
    return this.compactionPipeline.run(context);
  }

  private async *streamModel(
    context: Awaited<ReturnType<typeof this.assembleContext>>,
    options: QueryOptions,
    mode: PermissionMode
  ) {
    const tools =
      mode === PermissionMode.PLAN || options.suppressTools ? [] : this.toolRegistry.list();
    const system = context.systemPrompt;
    const { messages } = compileMessagesForApi(context.messages);

    const streamParams: Anthropic.Messages.MessageCreateParams = {
      model: options.model ?? 'claude-sonnet-4-5',
      max_tokens: Math.min(options.maxTokens ?? 8192, context.maxTokens),
      temperature: options.temperature ?? 0.7,
      system,
      messages,
    };

    if (tools.length > 0) {
      streamParams.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })) as Anthropic.Messages.Tool[];
      if (options.toolChoice === 'any') {
        streamParams.tool_choice = { type: 'any' };
      }
    }

    // Anthropic SDK 的 messages.stream() 在返回前会先发起 HTTP 请求；429/529/网络错误在
// 这个阶段或首次迭代时抛错。我们用 withRetry 包装：首次抛错会退避重试整个请求。
const stream = await withRetry(
      () => Promise.resolve().then(() => this.client.messages.stream(streamParams)),
      { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 8000 }
    );

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
