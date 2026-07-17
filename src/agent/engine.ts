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
  ContentBlock,
  ImageSource,
} from '../pkg/types.js';
import { Logger } from '../pkg/logger/index.js';
import { ContextAssembler } from '../context/assembler.js';
import { CompactionPipeline } from '../context/compaction.js';
import {
  hasCodeMutatingToolCall,
  runReflection,
  MAX_REFLECTIONS_PER_QUERY,
} from './reflection.js';
import { ToolRegistry } from '../tools/registry.js';
import { PermissionSystem, PLAN_ALLOWED_TOOLS } from '../permission/system.js';
import { shouldRunPrefetch } from './prefetch-config.js';
import {
  approvalKey,
  hasSessionApproval,
  rememberSessionApproval,
} from '../permission/session-memory.js';
import { authorizePrefetchTool } from '../permission/prefetch-gate.js';
import { SessionManager } from '../session/manager.js';
import { HookRegistry } from '../hooks/registry.js';
import { responseContentToBlocks } from './message-serializer.js';
import { executeToolCallsInOrder } from './tool-executor.js';
import { consumeModelStream, ModelStreamEvent, StreamEventLike } from './model-stream.js';
import { withRetry } from './retry.js';
import { resolveAppConfig } from '../pkg/app-config.js';
import { getLatestUserText, requiresToolExecution, requiresCodeMutation } from './tool-intent.js';
import {
  getPlanManager,
  formatPlanStepDriveMessage,
  formatPlanExecutionReport,
  MAX_PLAN_STEP_RETRIES,
} from './plan-mode.js';
import { compileMessagesForApi } from '../services/context-compiler/index.js';
import { captureCheckpoint } from '../services/checkpoint.js';
import {
  resolveDagPlanWithHistory,
  formatDagResults,
  loadSkillContextForIntent,
  runIntentPrefetch,
  isParallelAgentsEnabled,
  runParallelAgentPrefetch,
  buildParallelAgentTasks,
} from '../services/agent-scheduler/index.js';

const DAG_PREFETCH_NOTE = 'Running intent DAG prefetch before model summary.';

/** 模型未调工具时的重试上限 */
export const MAX_TOOL_NUDGE_RETRIES = 1;

export const MAX_MUTATION_NUDGE_RETRIES = 1;

/** Agent 循环最大轮次，防止 tool_use 死循环 */
export const MAX_AGENT_TURNS = 50;

const TOOL_NUDGE_MESSAGE =
  'You must call at least one tool (Read, Glob, Grep, or Bash) before answering. Do not reply with text only.';

const MUTATION_NUDGE_MESSAGE =
  'You inspected the project but did not change any files. You MUST use Edit or Write to apply the fix before finishing. Do not only describe the change.';

export type PermissionPromptFn = (
  tool: ToolCall,
  batchTools?: ToolCall[]
) => Promise<boolean>;

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
  private prefetchConfig: import('../pkg/app-config.js').ResolvedAppConfig['prefetch'];
  /** 工具执行根目录（Subagent worktree 隔离时覆盖 process.cwd） */
  private workingDirectory: string;
  private readLine?: (prompt: string) => Promise<string>;
  private log: Logger;

  constructor(options: QueryEngineOptions = {}) {
    const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    const baseURL = options.baseUrl ?? process.env['ANTHROPIC_BASE_URL'];
    this.client = options.anthropicClient ?? new Anthropic({ apiKey, baseURL });
    const appConfig = resolveAppConfig();
    this.contextMaxTokens = appConfig.contextMaxTokens;
    this.prefetchConfig = options.prefetch ?? appConfig.prefetch;
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.readLine = options.readLine;
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
    let mode = request.mode ?? state.mode;
    let effectiveOptions: QueryOptions = { ...(request.options ?? {}) };
    let toolNudgeAttempts = 0;
    let mutationNudgeAttempts = 0;
    let turnCount = 0;
    let toolsUsedInQuery = false;
    let dagPrefetched = false;
    let deferredText: string[] = [];
    /** 本 query 已确认过的批准键（approvalKey，非裸工具名） */
    const approvedKeys = new Set<string>();
    /** I3 reflection count within this query (capped at MAX_REFLECTIONS_PER_QUERY). */
    let reflectionCount = 0;
    let mutatedSinceReflection = false;
    let planStepHadTools = false;
    let planStepNudgeAttempts = 0;
    let planStepRetryCount = 0;
    const pinnedIntent = request.message ?? getLatestUserText(state.messages);
    const shouldAbort = (): boolean => effectiveOptions.shouldAbort?.() ?? false;

    // 核心：保证 request.message 进入会话；否则关预取时 API messages 为空（2013）
    if (request.images && request.images.length > 0) {
      attachImagesToLatestUserMessage(state, pinnedIntent, request.images);
    } else if (pinnedIntent.trim()) {
      ensureLatestUserTextMessage(state, pinnedIntent);
    }

    // I4: 若计划已在 executing，注入当前步
    {
      const active = getPlanManager().getActive();
      if (active?.status === 'executing' && mode !== PermissionMode.PLAN) {
        const step = getPlanManager().beginCurrentStep(active.id);
        if (step) {
          const drive = formatPlanStepDriveMessage(active, step);
          const last = state.messages[state.messages.length - 1];
          const already =
            last?.role === 'user' &&
            typeof last.content === 'string' &&
            last.content.includes(`[Plan execution] Plan ${active.id}`);
          if (!already) {
            state.messages.push({ role: 'user', content: drive, timestamp: Date.now() });
          }
          planStepHadTools = false;
          planStepNudgeAttempts = 0;
          planStepRetryCount = 0;
          if (effectiveOptions.toolChoice !== 'any') {
            effectiveOptions = { ...effectiveOptions, toolChoice: 'any' };
          }
        }
      }
    }

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

        // L1 调度：intent DAG 预取（可关：prefetch.enabled / PACODE_PREFETCH=0）
        const dagPlan = !dagPrefetched
          ? resolveDagPlanWithHistory(pinnedIntent, state.messages)
          : null;
        if (
          dagPlan &&
          mode !== PermissionMode.PLAN &&
          shouldRunPrefetch(this.prefetchConfig, dagPlan.intent)
        ) {
          dagPrefetched = true;
          deferredText = [];
          // 预取不是模型 tool 证据：失败/空预取不得关掉 M1 nudge（toolsUsedInQuery）
          this.log.debug(DAG_PREFETCH_NOTE);

          const skillCtx = await loadSkillContextForIntent(dagPlan.intent);
          if (skillCtx.loadedNames.length > 0) {
            yield { type: 'skill_loaded', skills: skillCtx.loadedNames };
          }

          const useParallelPrefetch =
            isParallelAgentsEnabled() &&
            (dagPlan.intent === 'inspect_project' ||
              dagPlan.intent === 'review_implementation' ||
              dagPlan.intent === 'code_audit');

          const queryId = `q_${state.sessionId}_${Date.now()}`;
          const batchNodeSpecs = useParallelPrefetch
            ? buildParallelAgentTasks(dagPlan.intent).flatMap((t) => t.nodes)
            : dagPlan.nodes;
          const prefetchBatchTools: ToolCall[] = batchNodeSpecs.map((node, i) => ({
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
            const need = this.permissionSystem.check({ tool: call, mode, context: state });
            if (need.requiresInteraction) {
              approvedKeys.add(approvalKey(call));
              rememberSessionApproval(state, call);
            }
            return this.executeTool(call, state);
          };
          const prefetchGen = useParallelPrefetch
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
            // 仅当至少一条预取成功时计为证据；全失败则保留 M1 nudge
            if (runs.some((r) => !r.result.isError)) {
              toolsUsedInQuery = true;
            }
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
        } else if (dagPlan) {
          // 命中 intent 但预取关闭：跳过 L1，纯模型 tool loop
          dagPrefetched = true;
          this.log.debug('Prefetch disabled; model-driven tool loop');
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

        // 代理可能把 stop_reason 标成 end_turn 但仍带 tool_use blocks
        const effectiveStop =
          response.toolCalls.length > 0 ? 'tool_use' : response.stopReason;

        if (effectiveStop === 'end_turn') {
          const noToolsUsed = response.toolCalls.length === 0;

          // I3: reflection — if the model just mutated code, run
          // the project's test/lint and inject failures back so
          // the next turn can act on real evidence. Bounded to
          // MAX_REFLECTIONS_PER_QUERY to avoid infinite loops.
          if (
            mutatedSinceReflection &&
            reflectionCount < MAX_REFLECTIONS_PER_QUERY
          ) {
            reflectionCount += 1;
            mutatedSinceReflection = false;
            const summary = await runReflection(this.workingDirectory);
            if (summary.failureMessage) {
              this.log.warn(
                `I3 reflection ${reflectionCount}/${MAX_REFLECTIONS_PER_QUERY}: ${summary.failed} verifier(s) failed`
              );
              // Inject the failure evidence as a synthetic user
              // message; force the next turn to act on it.
              state.messages.push({
                role: 'user',
                content: summary.failureMessage,
                timestamp: Date.now(),
              });
              effectiveOptions = { ...effectiveOptions, toolChoice: 'any' };
              continue;
            }
            // 无测脚本：软提示一次，不强制 toolChoice，避免假完成「已测」
            if (summary.skipNotice) {
              state.messages.push({
                role: 'user',
                content: summary.skipNotice,
                timestamp: Date.now(),
              });
            }
          }

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

          if (
            requiresCodeMutation(pinnedIntent) &&
            mode !== PermissionMode.PLAN &&
            toolsUsedInQuery &&
            !hasCodeMutatingToolCall(state.toolCallHistory) &&
            mutationNudgeAttempts < MAX_MUTATION_NUDGE_RETRIES
          ) {
            mutationNudgeAttempts++;
            deferredText = [];
            this.log.warn('Model ended without Edit/Write; nudging code mutation');
            state.messages.push({
              role: 'user',
              content: MUTATION_NUDGE_MESSAGE,
              timestamp: Date.now(),
            });
            effectiveOptions = { ...effectiveOptions, toolChoice: 'any' };
            continue;
          }

          // I4: 计划执行中 — end_turn 推进下一步，或完成计划
          {
            const active = getPlanManager().getActive();
            if (active?.status === 'executing' && mode !== PermissionMode.PLAN) {
              const cur = getPlanManager().getCurrentStep(active);
              const needsTool = Boolean(cur?.tool);
              if (needsTool && !planStepHadTools && planStepNudgeAttempts < 1) {
                planStepNudgeAttempts++;
                deferredText = [];
                state.messages.push({
                  role: 'user',
                  content:
                    'Plan step requires tool use. Call the appropriate tool (e.g. ' +
                    (cur?.tool ?? 'Read/Edit/Write') +
                    ') before ending this step.',
                  timestamp: Date.now(),
                });
                effectiveOptions = { ...effectiveOptions, toolChoice: 'any' };
                continue;
              }
              // 有界重试：仍无工具则重新注入本步；耗尽则 skip
              if (needsTool && !planStepHadTools) {
                if (planStepRetryCount < MAX_PLAN_STEP_RETRIES) {
                  planStepRetryCount++;
                  planStepNudgeAttempts = 0;
                  deferredText = [];
                  this.log.warn(
                    `Plan step ${cur?.index ?? '?'} retry ${planStepRetryCount}/${MAX_PLAN_STEP_RETRIES}`
                  );
                  state.messages.push({
                    role: 'user',
                    content:
                      formatPlanStepDriveMessage(active, cur!) +
                      `\n[Retry ${planStepRetryCount}/${MAX_PLAN_STEP_RETRIES}: previous attempt used no tools.]`,
                    timestamp: Date.now(),
                  });
                  effectiveOptions = { ...effectiveOptions, toolChoice: 'any' };
                  continue;
                }
                const skipped = getPlanManager().skipCurrentStep(
                  active.id,
                  'no tool use after retries'
                );
                deferredText = [];
                state.messages.push({
                  role: 'assistant',
                  content: responseContentToBlocks(response.content),
                  timestamp: Date.now(),
                });
                if (skipped.completed && skipped.plan) {
                  yield* flushDeferredText();
                  yield {
                    type: 'content_block_delta',
                    delta: {
                      index: 0,
                      text: `\n${formatPlanExecutionReport(skipped.plan)}\n`,
                    },
                  };
                  yield { type: 'message_stop', stopReason: response.stopReason };
                  break;
                }
                if (skipped.next && skipped.plan) {
                  planStepHadTools = false;
                  planStepNudgeAttempts = 0;
                  planStepRetryCount = 0;
                  state.messages.push({
                    role: 'user',
                    content:
                      `[Skipped prior step: ${skipped.reason}]\n` +
                      formatPlanStepDriveMessage(skipped.plan, skipped.next),
                    timestamp: Date.now(),
                  });
                  effectiveOptions = { ...effectiveOptions, toolChoice: 'any' };
                  continue;
                }
              }
              const adv = getPlanManager().advanceAfterTurn(active.id);
              if (adv.completed && adv.plan) {
                deferredText = [];
                state.messages.push({
                  role: 'assistant',
                  content: responseContentToBlocks(response.content),
                  timestamp: Date.now(),
                });
                yield* flushDeferredText();
                yield {
                  type: 'content_block_delta',
                  delta: { index: 0, text: `\n${formatPlanExecutionReport(adv.plan)}\n` },
                };
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
              if (adv.next && adv.plan) {
                deferredText = [];
                state.messages.push({
                  role: 'assistant',
                  content: responseContentToBlocks(response.content),
                  timestamp: Date.now(),
                });
                state.messages.push({
                  role: 'user',
                  content: formatPlanStepDriveMessage(adv.plan, adv.next),
                  timestamp: Date.now(),
                });
                planStepHadTools = false;
                planStepNudgeAttempts = 0;
                planStepRetryCount = 0;
                effectiveOptions = { ...effectiveOptions, toolChoice: 'any' };
                continue;
              }
            }
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

        if (effectiveStop === 'tool_use') {
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
              const key = approvalKey(toolCall);
              if (approvedKeys.has(key) || hasSessionApproval(state, toolCall)) {
                approvedCalls.push(toolCall);
                continue;
              }
              if (shouldAbort()) {
                resultById.set(toolCall.id, {
                  content: [{ type: 'text', text: 'Interrupted during permission prompt' }],
                  isError: true,
                });
                continue;
              }
              // H3: PermissionRequest hooks — deny(exit 2) wins; stdout "approve" skips UI
              const hookDecision = await this.runPermissionRequestHooks(toolCall, state);
              if (hookDecision === 'deny') {
                resultById.set(toolCall.id, {
                  content: [
                    {
                      type: 'text',
                      text: 'Permission denied by PermissionRequest hook',
                    },
                  ],
                  isError: true,
                });
                continue;
              }
              let confirmed = hookDecision === 'approve';
              if (!confirmed) {
                confirmed = await this.permissionPrompt(toolCall);
              }
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
              approvedKeys.add(key);
              rememberSessionApproval(state, toolCall);
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

          // I2：Edit/Write/NotebookEdit 成功批次后自动 stash checkpoint
          if (
            hasCodeMutatingToolCall(approvedCalls) &&
            approvedCalls.some((c) => {
              const r = resultById.get(c.id);
              return r && !r.isError;
            })
          ) {
            const idx = state.checkpointIndex ?? 0;
            const label = approvedCalls
              .filter((c) => ['Edit', 'Write', 'NotebookEdit'].includes(c.name))
              .map((c) => c.name)
              .join('+');
            const meta = captureCheckpoint(
              state.sessionId,
              idx,
              label || 'mutate',
              this.workingDirectory
            );
            if (meta) {
              state.checkpointIndex = idx + 1;
              this.log.info(`Checkpoint captured: ${meta.id}`);
            }
          }

          state.messages.push({
            role: 'user',
            content: toolResultBlocks,
            timestamp: Date.now(),
          });

          if (
            hasCodeMutatingToolCall(approvedCalls) &&
            approvedCalls.some((c) => {
              const r = resultById.get(c.id);
              return r && !r.isError;
            })
          ) {
            mutatedSinceReflection = true;
          }

          const exitedPlan = approvedCalls.some((c) => {
            if (c.name !== 'ExitPlanMode') return false;
            const r = resultById.get(c.id);
            return Boolean(r && !r.isError);
          });
          if (exitedPlan) {
            mode = PermissionMode.ACCEPT_EDITS;
            state.mode = PermissionMode.ACCEPT_EDITS;
            const active = getPlanManager().getActive();
            if (active?.status === 'executing') {
              const step = getPlanManager().beginCurrentStep(active.id);
              if (step) {
                state.messages.push({
                  role: 'user',
                  content: formatPlanStepDriveMessage(active, step),
                  timestamp: Date.now(),
                });
                planStepHadTools = false;
                planStepNudgeAttempts = 0;
                planStepRetryCount = 0;
                effectiveOptions = { ...effectiveOptions, toolChoice: 'any' };
              }
            }
          } else if (getPlanManager().getActive()?.status === 'executing') {
            planStepHadTools = true;
          }
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

  /** PLAN：只暴露白名单工具，否则模型无法调用 ExitPlanMode */
  private toolsForMode(mode: PermissionMode, suppressTools?: boolean) {
    if (suppressTools) return [];
    const all = this.toolRegistry.list();
    if (mode === PermissionMode.PLAN) {
      return all.filter((t) => PLAN_ALLOWED_TOOLS.has(t.name));
    }
    return all;
  }

  private async assembleContext(
    state: SessionState,
    options: QueryOptions,
    mode: PermissionMode
  ) {
    const tools = this.toolsForMode(mode);
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
    const tools = this.toolsForMode(mode, options.suppressTools);
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
          // 代理可能只在 finalMessage 带 tool_use，流事件缺失时补齐
          const merged = mergeToolCallsFromFinalMessage(event, finalMessage);
          if (finalMessage.usage) {
            yield {
              ...merged,
              usage: {
                input_tokens: finalMessage.usage.input_tokens,
                output_tokens: finalMessage.usage.output_tokens,
              },
            };
            continue;
          }
          yield merged;
          continue;
        } catch {
          /* usage optional */
        }
      }
      yield event;
    }
  }

  private buildToolContext(toolCall: ToolCall, state: SessionState): ToolContext {
    return {
      workingDirectory: this.workingDirectory,
      sessionState: state,
      hooks: this.hookRegistry,
      currentTool: toolCall,
      readLine: this.readLine,
    };
  }

  /** PermissionRequest：exit 2 / blocked → deny；stdout 含 approve → 跳过 UI；否则 ask */
  private async runPermissionRequestHooks(
    toolCall: ToolCall,
    state: SessionState
  ): Promise<'approve' | 'deny' | 'ask'> {
    const ctx = this.buildToolContext(toolCall, state);
    const hooks = this.hookRegistry.findMatching(HookType.PERMISSION_REQUEST, ctx);
    let approve = false;
    for (const hook of hooks) {
      try {
        const result = await this.hookRegistry.execute(hook);
        const exitCode = result.exitCode ?? 0;
        if (result.blocked || exitCode === 2) {
          return 'deny';
        }
        if (exitCode !== 0) {
          const msg = result.stderr || `Hook ${hook.name} exited with code ${exitCode}`;
          if (process.env['PACODE_HOOK_FAIL_OPEN'] === '1') {
            this.log.warn(`PermissionRequest hook non-zero exit (fail-open): ${msg}`);
            continue;
          }
          return 'deny';
        }
        const out = (result.stdout ?? '').trim().toLowerCase();
        if (out === 'approve' || out.startsWith('approve')) {
          approve = true;
        }
        if (out === 'deny' || out.startsWith('deny')) {
          return 'deny';
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log.warn(`PermissionRequest hook failed: ${msg}`);
        if (process.env['PACODE_HOOK_FAIL_OPEN'] !== '1') {
          return 'deny';
        }
      }
    }
    return approve ? 'approve' : 'ask';
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
      // H3: trigger PostToolUseFailure hook so users can react
      // to tool crashes (vs. the tool returning isError itself).
      const errMsg = error instanceof Error ? error.message : String(error);
      const failCtx = { ...ctx, errorMessage: errMsg };
      const failHooks = this.hookRegistry.findMatching(
        HookType.POST_TOOL_USE_FAILURE,
        failCtx
      );
      for (const hook of failHooks) {
        try {
          await this.hookRegistry.execute(hook);
        } catch (e) {
          this.log.warn(
            `PostToolUseFailure hook failed: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
      return {
        content: [{ type: 'text', text: errMsg }],
        isError: true,
      };
    }
  }

  private async defaultPermissionPrompt(
    tool: ToolCall,
    _batchTools?: ToolCall[]
  ): Promise<boolean> {
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
  /** 覆盖 resolveAppConfig().prefetch（测试用） */
  prefetch?: import('../pkg/app-config.js').ResolvedAppConfig['prefetch'];
  /** 工具 cwd；Subagent 隔离 worktree 时注入，默认 process.cwd() */
  workingDirectory?: string;
  /** AskUser 等交互工具用的读行（REPL 在 pause editor 后注入） */
  readLine?: (prompt: string) => Promise<string>;
}

/** 若流式未解析到 tool_use，从 finalMessage.content 补齐（代理兼容） */
export function mergeToolCallsFromFinalMessage(
  event: Extract<ModelStreamEvent, { type: 'model_complete' }>,
  finalMessage: { content?: Array<{ type: string; id?: string; name?: string; input?: unknown }>; stop_reason?: string | null }
): Extract<ModelStreamEvent, { type: 'model_complete' }> {
  if (event.toolCalls.length > 0) {
    return event;
  }
  const toolCalls: ToolCall[] = [];
  const content = [...event.content];
  for (const block of finalMessage.content ?? []) {
    if (block.type === 'tool_use' && block.id && block.name) {
      const input =
        block.input && typeof block.input === 'object'
          ? (block.input as Record<string, unknown>)
          : {};
      toolCalls.push({ id: block.id, name: block.name, input });
      content.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input,
        jsonParts: '',
      });
    }
  }
  if (toolCalls.length === 0) return event;
  const stopReason =
    finalMessage.stop_reason === 'tool_use' || toolCalls.length > 0
      ? ('tool_use' as const)
      : event.stopReason;
  return { ...event, content, toolCalls, stopReason };
}
export function ensureLatestUserTextMessage(state: SessionState, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const last = state.messages[state.messages.length - 1];
  if (last?.role === 'user' && typeof last.content === 'string' && last.content === text) {
    return;
  }
  if (
    last?.role === 'user' &&
    typeof last.content === 'string' &&
    last.content.trim() === trimmed
  ) {
    return;
  }
  state.messages.push({
    role: 'user',
    content: text,
    timestamp: Date.now(),
  });
}

/** G4：将 images 并入最新 user 消息（ContentBlock[]） */
export function attachImagesToLatestUserMessage(
  state: SessionState,
  text: string,
  images: ImageSource[]
): void {
  const blocks: ContentBlock[] = [];
  if (text.trim()) {
    blocks.push({ type: 'text', text });
  }
  for (const image of images) {
    blocks.push({ type: 'image', image });
  }
  if (blocks.length === 0) return;

  const last = state.messages[state.messages.length - 1];
  if (last?.role === 'user' && typeof last.content === 'string') {
    last.content = blocks;
    return;
  }
  state.messages.push({
    role: 'user',
    content: blocks,
    timestamp: Date.now(),
  });
}
