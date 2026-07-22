# PaCode - 类 Claude Code 架构设计与实施计划

> 基于 Claude Code v2.1.88 源码分析验证的 AI 编程助手框架

**版本:** 1.4.1
**日期:** 2026-07-22
**状态:** Phase H–K 主线完成；npm 包 `@sallon/pacode`；Bridge local / LSP / Voice STT / AUTO classifier；31 核心工具；`npm test`=unit+gate

### 实施状态快照

> **如何读「完成度」：** 百分比是相对 **Claude Code 全量能力 / 本仓库 Defer 清单** 的差距估计，**不是**「模块半残、不可用」。
> PaCode **已声明范围内的主线均已落地并可跑**；未到 100% 的原因是有意不做或尚未做的差距（见下方 Defer），不是缺入口。
> ✅ = 本仓库声明范围已完成。百分比保留一位估计，避免误读成精确 KPI。

| 模块 | 相对 CC/Defer | PaCode 范围 | 说明 |
|------|---------------|-------------|------|
| Query Engine | ~94% | ✅ 已交付 | 全循环；PermissionRequest；5xx 重试；Subagent + 预取证据门闩。剩余：无 Go agent core（Defer） |
| Context Assembly | ~85% | ✅ 已交付 | **10 源**组装（含 Recent Results + 工具目录）；Skills lazy index。剩余：源深度/裁剪策略相对 CC 仍粗 |
| Compaction | ~92% | ✅ 已交付 | L1–L5；L4 路径/工具/错误信号；L5 withRetry。剩余：L1 仅降 `max_tokens`；手动 `/compact` 无重试 |
| Tool Registry | **31/≈43** | ✅ 已交付 | **31 核心工具**（Diagnostics/LSP=真 client + tsc 回退）+ Plugin + MCP。非「96% 等于 CC 43 工具」 |
| Permission System | ~90% | ✅ 已交付 | 7 modes + tool-gate + session memory；`ml`=**特征启发式**（非神经网络，可选 `PACODE_CLASSIFIER_CMD`）。剩余：无容器级 Bash 沙箱（Defer） |
| Memory | ~85% | ✅ 已交付 | 用户 `.paude/memory/` + 项目 hash + auto-memory。剩余：自动抽取规则窄；无 SQLite（Defer） |
| Hooks / Skills / Plugins / MCP | ~92% | ✅ 已交付 | MCP stdio/sse/http/**websocket**；Bridge **v1-local**。剩余：无公网 Bridge SaaS（Defer） |
| CLI / REPL | ~96% | ✅ 已交付 | readline + Ink；`-p`/SDK；paste chips / live task / ↑↓ history；`/btw` `/effort` `/vim` `/voice`；`pacode bridge serve`。剩余：vim 仅经典 REPL；Voice=外部 STT |
| 模型/Retry | — | ✅ | 429/500/502/503/529 + 网络错误 |
| 测试 | — | ✅ | lines/statements ≥80；functions ≥79；branches ≥**74**；CI 跑 `test:coverage` |
| Eval harness | — | ✅ | M5 simulated；live+vs CC COMPARE + speed assert（live 需 API Key） |

### 8 项安全修复（commit bdd7555）

1. Grep 工具 `exec` → `execFile('rg', ['--', pattern, path])` — 消除 shell 注入
2. SECURITY_DIFF_SCAN 输出 `redactSecrets`（api_key / bearer / PEM 块）— 凭证外泄
3. worktree validator 拒 `.` / `..` / `/` / `\` — 路径逃逸
4. bash-secure rm regex 加 `/i` flag — 大小写 bypass
5. bash-secure base command：startswith → 精确等值匹配 — `lsmine` 不再被误判为 `ls`
6. bash-secure FORBIDDEN_CONSTRUCTS：deny `eval` / `exec` / `xargs` / `-exec` / `-execdir` / `env -i`
7. path-utils realpath 防止 symlink 跳出 workspace
8. engine DAG 旁路（**已回退**——bash-secure + deny 已足够；guard 过度收紧）

### Service 目录（12 个核心 + 扩展）

- `src/services/agent-scheduler/` — DAG 预取 + **默认真 LLM explore Subagent**（`PACODE_PREFETCH_DAG=1` 回退脚本）
- `src/services/context-compiler/` — 消息编译 + pairing
- `src/services/web-fetch/` — HTML→text + prompt injection sanitization
- `src/services/bridge/` — Bridge v1-partial MCP 清单 + **v1-local** session relay
- `src/services/lsp-client/` — JSON-RPC stdio LSP（typescript-language-server）
- `src/services/web-search/` — Brave API + mock fallback
- `src/services/mcp-sse-http/` — SSE + StreamableHTTP transport
- `src/services/mcp-auth/` — OAuth PKCE + AES-256-GCM token store
- `src/services/skill-mount/` — everything-claude-code skill 挂载
- `src/services/ask-user/` — REPL 交互式问题（对标 CC AskUserQuestionTool）
- `src/services/bash-jobs/` — 后台 Bash + BashOutput 环形缓冲
- `src/services/voice/` — Voice STT pipe（`PACODE_STT_CMD`）+ Buddy 旁白

扩展（同级）：`brief/`、`coordinator/`、`cron/`、`team/`、`task-registry/`、`diagnostics/`、`image-attach/`；另有顶层 `checkpoint.ts`。

**Defer:** Go agent core、SQLite、容器级 Bash 沙箱、公网 Bridge SaaS、内置 Whisper 权重

**G4 图片：** `ContentBlock.image` + `message-serializer` → Anthropic `media_type`；CLI `--image`；`src/services/image-attach/`

**已知遗留：**
- 默认模型 MiniMax-M3 + `api.minimaxi.com/anthropic`（不再依赖 `~/.claude/settings.json`）
- 2 个 locked worktree（早期 audit 残留，harness 内部）
- M5 live once-success 依赖 API Key（CI 用 simulated agent）

---

## 目录

1. [项目愿景](#1-项目愿景)
2. [核心发现](#2-核心发现)
3. [架构总览](#3-架构总览)
4. [核心模块设计](#4-核心模块设计)
5. [Agent 循环机制](#5-agent-循环机制)
6. [工具系统](#6-工具系统)
7. [权限系统](#7-权限系统)
8. [上下文管理](#8-上下文管理)
9. [记忆系统](#9-记忆系统)
10. [扩展机制](#10-扩展机制)
11. [实施路径](#11-实施路径)
12. [技术栈](#12-技术栈)
13. [项目结构](#13-项目结构)

---

## 1. 项目愿景

### 1.1 目标

**PaCode** 是一个基于 AI 的智能编程助手框架，参考 Claude Code 的核心架构理念完全独立设计与实现，不使用任何 Claude Code 源代码。

### 1.2 核心目标

- 🤖 AI 驱动的代码分析与生成
- 🔌 插件化架构 (类 MCP)
- 🛠️ 强大的工具系统
- 💾 文件化持久化记忆
- 🖥️ 交互式 CLI 界面
- 🛡️ 分级权限安全系统

### 1.3 设计哲学

> **"Only 1.6% of Claude Code's codebase is AI decision logic. The other 98.4% is deterministic infrastructure"**
>
> — VILA-Lab, Dive into Claude Code

真正的工程复杂度不在于 AI 决策逻辑，而在于：
- 权限系统 (7 层安全检查)
- 上下文压缩 (5 层渐进压缩)
- 工具路由与执行
- 会话持久化与恢复

---

## 2. 核心发现

### 2.1 Claude Code 架构洞察

基于 VILA-Lab 对 Claude Code v2.1.88 (~1,900 TypeScript 文件, ~512K 行代码) 的源码分析：

| 发现 | 详情 |
|------|------|
| **1.6% AI 逻辑** | Agent 循环本身是一个简单的 while-loop |
| **98.4% 基础设施** | 权限、上下文、工具路由、恢复逻辑 |
| **5 层压缩管道** | Budget → Snip → Microcompact → Collapse → Auto-compact |
| **7 级权限模式** | plan → default → acceptEdits → auto → dontAsk → bypassPermissions → bubble |
| **4 种扩展机制** | Hooks (zero) → Skills (low) → Plugins (medium) → MCP (high) |
| **10 个上下文源** | 系统提示词、CLAUDE.md、Rules、Skills、Memory、MCP Tools、Recent Results 等 |

### 2.2 架构原则

1. **Human Decision Authority** - 人类始终保持最终决策权
2. **Safety & Security** - 防御深度，7 层安全检查
3. **Reliable Execution** - 工具执行可预测、可恢复
4. **Capability Amplification** - 通过扩展机制增强能力
5. **Contextual Adaptability** - 5 层压缩适应不同上下文压力

---

## 3. 架构总览

### 3.1 分层架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PaCode Architecture                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    User Interface Layer                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐│   │
│  │  │  CLI Entry   │  │  Slash Cmd  │  │  Permission Prompts ││   │
│  │  │   (Ink/TUI) │  │   Handler   │  │   & Confirmations  ││   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘│   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                  │                                   │
│                                  ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Query Engine (Core Loop)                  │   │
│  │  ┌─────────────────────────────────────────────────────────┐│   │
│  │  │              while (stop_reason === "tool_use")          ││   │
│  │  │                  assemble → call → execute → repeat      ││   │
│  │  └─────────────────────────────────────────────────────────┘│   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                  │                                   │
│         ┌────────────────────────┼────────────────────────┐         │
│         ▼                        ▼                        ▼         │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐  │
│  │   Context   │         │   Tool      │         │  Permission  │  │
│  │   Assembly  │         │   Registry  │         │    System    │  │
│  │ (10 sources)│         │             │         │  (7 modes)   │  │
│  └─────────────┘         └─────────────┘         └─────────────┘  │
│         │                        │                        │         │
│         ▼                        ▼                        ▼         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Tool Execution Layer                       │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │   │
│  │  │  Bash    │  │  File    │  │  Grep    │  │   Glob     │ │   │
│  │  │  Tool    │  │  Tools   │  │  Tool    │  │   Tool     │ │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                  │                                   │
│                                  ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   State & Persistence                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐│   │
│  │  │   Session   │  │   Memory    │  │  Context Compaction ││   │
│  │  │   Store     │  │   (Files)   │  │   (5-layer pipe)   ││   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘│   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   Extensibility Layer                         │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │   │
│  │  │   Hooks  │  │  Skills  │  │ Plugins  │  │     MCP    │ │   │
│  │  │  (zero)  │  │  (low)   │  │ (medium) │  │    (high)  │ │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流图

```
User Input
    │
    ▼
┌───────────────┐
│  CLI Parser   │ ─── Tokenize & Parse & Command Routing
└───────────────┘
    │
    ▼
┌───────────────┐
│    Session    │ ─── 加载会话状态、历史、记忆
└───────────────┘
    │
    ▼
┌───────────────┐
│   Context     │ ─── 10 sources assembly + 5-layer compaction
│   Assembly    │
└───────────────┘
    │
    ▼
┌───────────────┐
│    Model      │ ─── Anthropic API (Streaming)
│    Call       │ ─── stop_reason: tool_use | end_turn | max_tokens
└───────────────┘
    │
    ├──▶ end_turn ──▶ Output Response ──▶ CLI Display
    │
    └──▶ tool_use ──▶ Tool Dispatch ──▶ Permission Gate
                                                │
                                                ▼
                                        ┌───────────────┐
                                        │ Tool Registry │
                                        └───────────────┘
                                                │
                                                ▼
                                        ┌───────────────┐
                                        │   Executor    │ ──▶ Hooks
                                        └───────────────┘
                                                │
                                                ▼
                                        ┌───────────────┐
                                        │    Memory     │ ──▶ Append Results
                                        └───────────────┘
                                                │
                                                └──────────────────▶ Loop
```

---

## 4. 核心模块设计

### 4.1 模块职责矩阵

| 模块 | Claude Code 对应 | 职责 | PaCode 状态 |
|------|-----------------|------|-------------|
| **Query Engine** | `query.ts` AsyncGenerator | Agent 循环核心 | ✅ `src/agent/engine.ts` |
| **Context Assembly** | `assemble()` | **10** 个上下文源组合 | ✅ `src/context/assembler.ts` |
| **Tool Registry** | `tools/` ~43 modules | 工具注册、分发、并发控制 | ✅ **31** 核心 + Plugin + MCP |
| **Permission System** | 7 modes + Classifier | 7 模式 + tool-gate + 非 TTY deny；AUTO=启发式/可选外部 cmd | ✅ Layer 4 `tool-gate.ts` |
| **Memory/Compaction** | 5-layer pipeline | 上下文压缩 + 文件记忆 | ✅ L1–L5 + project memory |
| **Session Store** | Append-oriented | 会话持久化 | ✅ `src/session/manager.ts` |
| **Hooks/Skills/Plugins/MCP** | 4 extensibility | 扩展机制 | ✅ Hooks/Skills/Plugins/MCP + bridge v1-local |
| **CLI/TUI** | Ink/React | 用户界面 | ✅ REPL + Ink `--tui` + paste/live-task/history |

### 4.2 核心接口定义

```typescript
// Query Engine 核心接口
interface QueryEngine {
  // 异步生成器式循环
  query(request: QueryRequest): AsyncGenerator<QueryEvent>;
  
  // 会话状态
  state: SessionState;
  
  // 上下文管理
  context: ContextManager;
}

// 查询请求
interface QueryRequest {
  message: string;
  mode: PermissionMode;
  options?: QueryOptions;
}

// 查询事件 (流式)
type QueryEvent =
  | { type: 'content_block_delta'; delta: TextDelta }
  | { type: 'tool_use'; tool: ToolCall }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'content_block_stop' }
  | { type: 'message_stop'; stop_reason: StopReason };

// 工具调用
interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// 停止原因
type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';
```

---

## 5. Agent 循环机制

### 5.1 9 步查询管道

```
┌─────────────────────────────────────────────────────────────────────┐
│                     9-Step Query Pipeline                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Step 1: Input Processing                                          │
│   └─ Parse user message, handle special commands (/slash, /clear)   │
│                              ▼                                      │
│   Step 2: Context Loading                                           │
│   └─ CLAUDE.md → Rules → Skills → Memory → MCP Tools → Project    │
│                              ▼                                      │
│   Step 3: Pre-Model Shapers (5-layer compaction)                  │
│   └─ Budget → Snip → Microcompact → Context Collapse → Auto-compact│
│                              ▼                                      │
│   Step 4: Model Call (Streaming)                                    │
│   └─ Anthropic Messages API → stop_reason: tool_use | end_turn    │
│                              ▼                                      │
│   Step 5: Tool Dispatch                                             │
│   └─ Parse tool_use blocks, check concurrency safety, group batches │
│                              ▼                                      │
│   Step 6: Permission Gate                                           │
│   └─ 7 modes: plan → default → acceptEdits → auto → dontAsk → ... │
│                              ▼                                      │
│   Step 7: Tool Execution                                            │
│   └─ Concurrent batch execution, hook interception, error recovery  │
│                              ▼                                      │
│   Step 8: Result Processing                                          │
│   └─ Append results to message history, update task state           │
│                              ▼                                      │
│   Step 9: Loop Check                                                │
│   └─ stop_reason === "tool_use" → GOTO Step 4                      │
│      stop_reason === "end_turn" → Exit & Display                   │
│      stop_reason === "max_tokens" → Recovery & Retry                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Agent Loop 实现模式

```typescript
// PaCode Agent Loop (Pseudo-code)
async function* agentLoop(request: QueryRequest): AsyncGenerator<QueryEvent> {
  const state = createSessionState(request);
  
  while (true) {
    // Step 1-3: Context Assembly
    const context = await assembleContext(state);
    const compacted = await runCompactionPipeline(context);
    
    // Step 4: Model Call
    const response = await callModelWithStreaming(compacted);
    
    // Handle stop reasons
    if (response.stop_reason === 'end_turn') {
      // Final output
      for (const block of response.content) {
        yield { type: 'content_block_delta', delta: block.delta };
      }
      break;
    }
    
    if (response.stop_reason === 'tool_use') {
      // Step 5-8: Tool Execution
      for (const toolCall of response.tool_calls) {
        // Permission check
        const allowed = await permissionSystem.check(toolCall, state.mode);
        if (!allowed) {
          yield { type: 'tool_result', error: 'Permission denied' };
          continue;
        }
        
        // Execute with hooks
        const result = await toolRegistry.execute(toolCall, {
          hooks: state.hooks,
          context: state
        });
        
        yield { type: 'tool_result', result };
        state.messages.push({ role: 'user', content: result });
      }
      // Continue loop
      continue;
    }
    
    if (response.stop_reason === 'max_tokens') {
      // Recovery: increase max_tokens and retry
      state.maxOutputTokensRecoveryCount++;
      continue;
    }
  }
  
  // Cleanup
  await sessionStore.save(state);
}
```

### 5.3 并发工具执行

```typescript
// 工具分组策略 (isConcurrencySafe)
interface ToolExecutionBatch {
  id: string;
  tools: ToolCall[];
  results: ToolResult[];
}

// 执行逻辑
async function executeToolBatches(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  const batches: ToolExecutionBatch[] = [];
  let currentBatch: ToolCall[] = [];
  
  for (const toolCall of toolCalls) {
    const tool = toolRegistry.get(toolCall.name);
    
    if (tool.concurrencySafe && currentBatch.every(t => 
      toolRegistry.get(t.name).concurrencySafe
    )) {
      // Add to current batch (parallel execution)
      currentBatch.push(toolCall);
    } else {
      // Flush current batch
      if (currentBatch.length > 0) {
        batches.push({ id: crypto.randomUUID(), tools: currentBatch, results: [] });
      }
      // New serial batch
      batches.push({ id: crypto.randomUUID(), tools: [toolCall], results: [] });
      currentBatch = [];
    }
  }
  
  // Execute all batches (batches run sequentially, tools within batch run parallel)
  const results: ToolResult[] = [];
  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.tools.map(tool => executeTool(tool))
    );
    results.push(...batchResults);
  }
  
  return results;
}
```

---

## 6. 工具系统

### 6.1 核心工具集 (8 个)

Claude Code 的核心工具 arsenal，PaCode 将实现这些：

| 工具 | 功能 | 并发安全 | 权限级别 |
|------|------|---------|---------|
| **Bash** | 执行 shell 命令 | ❌ | highest |
| **Read** | 读取文件内容 | ✅ | low |
| **Edit** | 编辑文件 (patch) | ❌ | medium |
| **Write** | 写入文件 (完整替换) | ❌ | medium |
| **Grep** | 代码搜索 (ripgrep) | ✅ | low |
| **Glob** | 文件模式匹配 | ✅ | low |
| **Task** | 启动子代理 | ❌ | high |
| **TodoWrite** | 任务列表管理 | ✅ | low |

### 6.2 工具接口定义

```typescript
// 工具定义
interface ToolDefinition {
  name: string;                    // 工具唯一标识 (e.g., "Bash", "Read")
  description: string;             // 工具描述 (用于 LLM 理解何时使用)
  input_schema: z.ZodSchema;      // 输入参数验证 schema
  output_schema?: z.ZodSchema;     // 输出参数验证 schema
  
  // 执行特性
  concurrencySafe: boolean;        // 是否可与其他工具并行执行
  requiresDirectory?: boolean;     // 是否需要工作目录上下文
  sideEffects?: SideEffect[];      // 副作用类型
  
  // 权限
  permissionMode: PermissionMode;  // 最小所需权限级别
  hookPoints?: HookPoint[];        // 钩子触发点
  
  // 核心方法
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

// 工具执行上下文
interface ToolContext {
  workingDirectory: string;
  sessionState: SessionState;
  hooks: HookRegistry;
  mcpServers?: MCPServerConnection[];
}

// 工具结果
interface ToolResult {
  content: ToolResultContent[];
  is_error?: boolean;
  preserve?: boolean;  // 是否保留在压缩时
}

// 工具结果内容
type ToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource }
  | { type: 'resource'; resource: Resource };

// 工具注册表
class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  execute(call: ToolCall, context: ToolContext): Promise<ToolResult>;
}
```

### 6.3 工具执行流程

```
Tool Call Received
        │
        ▼
┌───────────────────┐
│  Parse & Validate │ ──▶ Invalid? ──▶ Return Error
└───────────────────┘
        │ Valid
        ▼
┌───────────────────┐
│  Pre-Tool Hooks   │ ──▶ Exit 2? ──▶ Block & Return
└───────────────────┘
        │ Continue
        ▼
┌───────────────────┐
│ Permission Check  │ ──▶ Denied? ──▶ Prompt User / Return Error
└───────────────────┘
        │ Allowed
        ▼
┌───────────────────┐
│   Tool Executor   │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Post-Tool Hooks   │
└───────────────────┘
        │
        ▼
    Return Result
```

---

## 7. 权限系统

### 7.1 7 级权限模式

```
Permission Modes (Graduated Trust Spectrum)
═══════════════════════════════════════════════════════════════════════

  ┌─────────────────┐
  │      plan       │  仅规划模式：不执行任何操作，仅生成计划
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │    default      │  标准模式：每个操作都需要用户确认
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  acceptEdits    │  自动批准：文件编辑和文件系统 Bash 命令
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │     auto        │  ML 分类器决策：高置信度自动批准，低置信度询问
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │    dontAsk      │  除危险操作(destructive)外都自动批准
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │bypassPermissions│  跳过所有权限检查 (⚠️ 危险!)
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │     bubble      │  内部模式：仅用于特定内部流程
  └─────────────────┘

═══════════════════════════════════════════════════════════════════════
```

### 7.2 7 层安全检查

```
┌─────────────────────────────────────────────────────────────────────┐
│                    7-Layer Permission Pipeline                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Layer 1: Hook Pre-Filter                                          │
│   └─ PreToolUse hook can exit(2) to block                           │
│                              ▼                                      │
│   Layer 2: Rule Engine                                               │
│   └─ Pattern matching rules (e.g., "deny: rm -rf /")                │
│                              ▼                                      │
│   Layer 3: Permission Mode                                           │
│   └─ Current mode determines base allow/deny                        │
│                              ▼                                      │
│   Layer 4: Tool Permission Level                                     │
│   └─ Each tool declares minimum required permission                  │
│                              ▼                                      │
│   Layer 5: Classifier (G6 deterministic default; PACODE_CLASSIFIER=ml opt-in) │
│   └─ classifyToolCall risk/category/confidence (AUTO + DEFAULT)      │
│                              ▼                                      │
│   Layer 6: User Interaction                                          │
│   └─ Interactive confirmation prompt                                 │
│                              ▼                                      │
│   Layer 7: Execution Environment                                     │
│   └─ Shell sandboxing, resource limits                               │
│                                                                      │
│   ✋ Deny-first: Any layer can block, blocking is final             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.3 权限接口定义

```typescript
// 权限模式
enum PermissionMode {
  PLAN = 'plan',                    // 仅规划
  DEFAULT = 'default',              // 每次确认
  ACCEPT_EDITS = 'acceptEdits',    // 自动编辑
  AUTO = 'auto',                   // ML 分类器
  DONT_ASK = 'dontAsk',            // 除危险外都批准
  BYPASS = 'bypassPermissions',     // 跳过所有检查
  BUBBLE = 'bubble',               // 内部模式
}

// 权限检查请求
interface PermissionCheckRequest {
  tool: ToolCall;
  mode: PermissionMode;
  context: SessionState;
}

// 权限检查结果
interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requiresInteraction?: boolean;
  interactionType?: 'confirm' | 'select' | 'input';
}

// 权限系统
class PermissionSystem {
  // 7 层检查
  async check(request: PermissionCheckRequest): Promise<PermissionCheckResult>;
  
  // 交互式确认
  async promptUser(interaction: PermissionInteraction): Promise<boolean>;
  
  // ML 分类器 (auto 模式)
  async classifyCommand(command: string): Promise<ClassificationResult>;
}

// Bash 命令分类结果
interface ClassificationResult {
  isSafe: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason?: string;
  category?: 'read_only' | 'file_edit' | 'destructive' | 'network' | 'unknown';
}
```

### 7.4 Bash 安全机制

```typescript
// Parser Differential Defense
// 比较 AST 解析结果与实际 shell 执行结果

interface BashSecurityConfig {
  allowedCommands: string[];        // 白名单命令
  deniedPatterns: RegExp[];        // 拒绝模式
  maxOutputLines: number;          // 最大输出行数
  timeoutMs: number;              // 超时时间
  sandboxLevel: 'none' | 'container' | 'chroot';
}

// 安全检查流程
async function secureBashExecute(
  command: string,
  config: BashSecurityConfig
): Promise<BashResult> {
  // 1. AST 解析
  const ast = parseShellAST(command);
  
  // 2. 静态分析
  const staticResult = staticAnalysis(ast, config);
  if (!staticResult.safe) {
    return { error: staticResult.reason };
  }
  
  // 3. 实际执行 (沙箱)
  const result = await executeInSandbox(command, config);
  
  // 4. 输出检查
  if (result.stdout.lines > config.maxOutputLines) {
    result.stdout = result.stdout.truncate(config.maxOutputLines);
    result.truncated = true;
  }
  
  return result;
}
```

---

## 8. 上下文管理

### 8.1 10 个上下文源

按优先级顺序组合以下来源（实现见 `src/context/assembler.ts:45-99`）：

| # | 来源 | 描述 | 上下文成本 |
|---|------|------|----------|
| 1 | System Prompt | 核心指令和行为定义 | 固定 |
| 2 | CLAUDE.md | 项目级指令文件 | 低 |
| 3 | Rules Layer | `~/.claude/rules/` + `.claude/rules/` 规则 | 低 |
| 4 | Skills | `.claude/skills/` 技能（默认 lazy index） | 低-中 |
| 5 | Working Memory | 当前会话历史摘要 | 高 |
| 6 | Task Context | TodoWrite 任务状态和待办事项 | 中 |
| 7 | MCP Tools | 外部工具定义摘要 | 高 |
| 8 | Project Context | 项目结构、依赖等 | 中 |
| 9 | Memory | 用户偏好 `~/.paude/memory/` + 项目 hash 分区 | 中 |
| 10 | Recent Results | 最近工具执行结果 | 高 |

### 8.2 5 层压缩管道

```
┌─────────────────────────────────────────────────────────────────────┐
│                   5-Layer Compaction Pipeline                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Trigger: effectiveContextWindow > ~83% (167K / 200K tokens)        │
│                                                                      │
│   Layer 1: Budget Reduction（限速，非剪消息）                        │
│   └─ 降低 max_tokens 预算，强制更短输出                              │
│                              ▼                                      │
│   Layer 2: Snip                                                     │
│   └─ 裁剪超长工具输出，保留关键部分                                 │
│                              ▼                                      │
│   Layer 3: Microcompact                                             │
│   └─ 手术式压缩：工具结果 500-2000 tokens → 1 行摘要                 │
│                              ▼                                      │
│   Layer 4: Context Collapse                                         │
│   └─ 读取时投影：非破坏性压缩，保留原始引用                          │
│                              ▼                                      │
│   Layer 5: Auto-compact (Last Resort)                              │
│   └─ 调用模型生成摘要，用 <compact> 标签替换历史消息                 │
│      压缩率 ~85% (167K → 25K tokens)                                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.3 上下文接口定义

```typescript
// 上下文管理器
class ContextManager {
  private sources: ContextSource[];
  private compactionPipeline: CompactionLayer[];
  
  // 组装完整上下文
  async assemble(state: SessionState): Promise<ModelContext>;
  
  // 运行压缩管道
  async runCompaction(context: ModelContext): Promise<ModelContext>;
  
  // 计算 token 使用量
  countTokens(context: ModelContext): TokenCount;
}

// 上下文源
interface ContextSource {
  name: string;
  priority: number;
  load(state: SessionState): Promise<ContextBlock[]>;
  getTokenCost(): number;
}

// 压缩层
interface CompactionLayer {
  name: string;
  threshold: number;  // 触发阈值 (tokens)
  compress(context: ModelContext): Promise<ModelContext>;
}

// 模型上下文
interface ModelContext {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  maxTokens: number;
  tokenCount: number;
  compactBoundaries?: CompactBoundary[];
}

// 压缩边界标记
interface CompactBoundary {
  type: 'compact_boundary';
  summary: string;
  originalMessageCount: number;
  timestamp: Date;
}
```

---

## 9. 记忆系统

### 9.1 三层记忆架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Memory Hierarchy                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │              Working Memory (当前会话)                        │   │
│   │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │   │
│   │  │Conversation  │ │  Tool Call   │ │ Intermediate │       │   │
│   │  │   History    │ │   History    │ │   Results    │       │   │
│   │  └──────────────┘ └──────────────┘ └──────────────┘       │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │              Project Memory (项目级)                          │   │
│   │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │   │
│   │  │ Codebase Map │ │ Architecture │ │    Key       │       │   │
│   │  │              │ │   Summary    │ │  Decisions   │       │   │
│   │  └──────────────┘ └──────────────┘ └──────────────┘       │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │              Global Memory (持久化)                          │   │
│   │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │   │
│   │  │    User      │ │  Workspace   │ │  Learned     │       │   │
│   │  │ Preferences  │ │  Patterns    │ │  Conventions │       │   │
│   │  └──────────────┘ └──────────────┘ └──────────────┘       │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.2 记忆存储设计 (文件化)

> Claude Code 使用**文件-based 记忆**，无向量数据库，完全可检查、可编辑、可版本控制。

```
.paude/
├── memory/                      # 全局记忆
│   ├── user_preferences.md
│   ├── workspace_patterns.md
│   └── learned_conventions.md
├── sessions/                    # 会话存储 (Append-oriented)
│   ├── session_2026-07-03_abc123.json
│   └── session_2026-07-03_def456.json
└── projects/                    # 项目级记忆
    └── {project_hash}/
        ├── codebase_map.md
        ├── architecture.md
        └── decisions/
            └── 2026-07-01_refactor-auth.md
```

### 9.3 记忆接口定义

```typescript
// 记忆存储
interface MemoryStore {
  // 读取
  read(key: MemoryKey): Promise<MemoryBlock | null>;
  
  // 写入
  write(key: MemoryKey, block: MemoryBlock): Promise<void>;
  
  // 更新 (追加)
  append(key: MemoryKey, content: string): Promise<void>;
  
  // 搜索
  search(query: string, options?: SearchOptions): Promise<MemoryBlock[]>;
  
  // 删除
  delete(key: MemoryKey): Promise<void>;
}

// 记忆块
interface MemoryBlock {
  key: MemoryKey;
  type: MemoryType;
  content: string;
  metadata: {
    created: Date;
    updated: Date;
    tags: string[];
    version: number;
  };
}

// 记忆键
interface MemoryKey {
  scope: 'user' | 'project' | 'session';
  category: string;
  id: string;
}

// 记忆类型
enum MemoryType {
  PREFERENCE = 'preference',
  PATTERN = 'pattern',
  DECISION = 'decision',
  CONVENTION = 'convention',
  CODEBASE_MAP = 'codebase_map',
  ARCHITECTURE = 'architecture',
}
```

---

## 10. 扩展机制

### 10.1 4 种扩展机制 (按上下文成本)

```
┌─────────────────────────────────────────────────────────────────────┐
│                   Extensibility - Graduated Context Cost             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Cost: ZERO ────────────────────────────────────────────────── HIGH │
│                                                                      │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────────┐  │
│   │  Hooks   │    │  Skills  │    │ Plugins  │    │     MCP     │  │
│   │  (zero)  │    │  (low)   │    │ (medium) │    │   (high)    │  │
│   ├──────────┤    ├──────────┤    ├──────────┤    ├────────────┤  │
│   │PreToolUse│    │ Markdown │    │  Custom   │    │   外部服务   │  │
│   │PostToolUse│   │  文件     │    │  Commands │    │   集成     │  │
│   │SessionStr│    │  技能     │    │   代理     │    │  MCP 协议   │  │
│   │SessionStp│    │  定义     │    │  完整包    │    │            │  │
│   │Notificati│    │          │    │            │    │            │  │
│   │SubagentSt│    │          │    │            │    │            │  │
│   └──────────┘    └──────────┘    └──────────┘    └────────────┘  │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                  Injection Points                             │   │
│   │                                                                  │   │
│   │   assemble() ──▶ Hooks, Skills, Rules                         │   │
│   │   model() ──────▶ MCP Tools                                   │   │
│   │   execute() ────▶ Hooks only                                 │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.2 Hooks 系统

```typescript
// Hook 类型
enum HookType {
  PRE_TOOL_USE = 'PreToolUse',        // 工具执行前
  POST_TOOL_USE = 'PostToolUse',      // 工具执行后
  SESSION_START = 'SessionStart',      // 会话开始
  SESSION_STOP = 'SessionStop',        // 会话结束
  NOTIFICATION = 'Notification',       // 通知
  SUBAGENT_STOP = 'SubagentStop',      // 子代理停止
}

// Hook 定义
interface Hook {
  name: string;
  type: HookType;
  command: string | string[];
  cwd?: string;
  env?: Record<string, string>;
}

// Hook 执行结果
interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// Hook 配置位置
// ~/.claude/settings.json (shared)
// ~/.claude/settings.local.json (personal)
interface HookConfig {
  hooks: {
    [K in HookType]?: Hook[];
  };
}
```

### 10.3 Skills 系统

Skills 是 Markdown 文件定义的技能，LLM 根据描述自行判断何时使用。

```
.claude/skills/
├── debug/
│   └── SKILL.md          # 调试技能
├── refactor/
│   └── SKILL.md          # 重构技能
├── test/
│   └── SKILL.md          # 测试技能
└── review/
    └── SKILL.md          # 审查技能
```

```markdown
# Skill: Code Review

## Description
执行代码审查，发现潜在问题和改进点。

## When to Use
- 用户要求 "review this code"
- 提交 PR 前的自查
- 发现可疑 bug 后

## Tools
- Grep: 搜索代码模式
- Read: 读取源文件
- Bash: 运行测试

## Workflow
1. 分析代码结构
2. 检查常见问题模式
3. 运行测试
4. 生成报告
```

### 10.4 MCP 客户端

```typescript
// MCP 客户端配置
interface MCPClientConfig {
  servers: MCPServerConfig[];
}

// MCP 服务器配置
interface MCPServerConfig {
  name: string;
  type: 'stdio' | 'sse' | 'http' | 'websocket';
  command?: string;          // stdio 类型
  args?: string[];
  url?: string;              // http/sse/websocket 类型
  env?: Record<string, string>;
  auth?: MCPAuthConfig;
}

// MCP 工具包装
interface MCPToolWrapper {
  originalName: string;      // 原始工具名
  prefixedName: string;      // mcp__{server}__{tool}
  description: string;
  inputSchema: z.ZodSchema;
  
  // 调用 MCP 服务器
  call(input: unknown): Promise<ToolResult>;
}

// MCP 客户端
class MCPClient {
  async connect(config: MCPServerConfig): Promise<MCPServerConnection>;
  async disconnect(name: string): Promise<void>;
  async listTools(server: string): Promise<MCPToolDefinition[]>;
  async callTool(server: string, tool: string, input: unknown): Promise<ToolResult>;
  
  // 状态管理
  getConnectionStatus(server: string): ConnectionStatus;
  onToolListChanged(server: string, callback: () => void): void;
}
```

---

## 11. 实施路径

### 11.1 阶段计划

```
Week 1-2: 核心框架
├── Day 1-2:   项目初始化、CLI 脚手架
├── Day 3-4:   Query Engine 核心循环
├── Day 5-7:   Session 管理器
├── Day 8-10:  基础工具 (Bash, Read, Edit, Write)
└── Day 11-14: Anthropic API 集成、流式响应

Week 3: 安全与权限
├── Day 15-17: Permission System (7 modes)
├── Day 18-20: Hooks System
└── Day 21:    Bash 安全沙箱

Week 4: 上下文管理
├── Day 22-24: Context Assembly (9 sources)
├── Day 25-27: 5-layer Compaction Pipeline
└── Day 28:    Memory System (文件化)

Week 5: 工具增强
├── Day 29-30: Grep, Glob 工具
├── Day 31:    Task, TodoWrite 工具
└── Day 32-35: 工具并发执行优化

Week 6: 扩展机制
├── Day 36-38: Skills System
├── Day 39-40: Plugins System
└── Day 41-42: MCP Client

Week 7-8: 完善与测试
├── Day 43-45: CLI UI 优化 (Ink/TUI)
├── Day 46-50: 测试覆盖 (80%+)
├── Day 51-53: 文档编写
└── Day 54-56: 发布准备
```

### 11.2 关键里程碑

| 阶段 | 里程碑 | 验收标准 |
|------|--------|---------|
| Phase 1 | **MVC** | 能执行简单任务 (read file, write file) | ✅ |
| Phase 2 | **Tool Loop** | Agent 循环执行工具并返回结果 | ✅ |
| Phase 3 | **Safe** | 权限系统阻止危险操作 | ✅ |
| Phase 4 | **Long Session** | 5 层压缩支持长会话 | ✅ |
| Phase 5 | **Extensible** | Skills/Plugins/MCP 正常工作 | ✅ |
| Phase 6 | **Production** | 80%+ 测试覆盖，文档完整 | ✅ 80.3% + eval harness |

---

## 12. 技术栈

### 12.1 推荐方案: TypeScript/Go 双轨制

| 层级 | 技术选型 | 理由 |
|------|----------|------|
| **CLI** | TypeScript + Ink/React | 快速迭代、丰富 UI 库 |
| **Agent Core** | Go | 高性能、并发处理能力强 |
| **Tool Plugins** | 多语言支持 | 通过 MCP 协议扩展 |
| **Memory** | SQLite + 文件存储 | 轻量 + 简单 |
| **Config** | YAML/TOML | 人类可读 |

### 12.2 核心依赖

```json
{
  "dependencies": {
    // CLI & UI
    "ink": "^5.0.0",
    "react": "^18.0.0",
    
    // AI
    "@anthropic-ai/sdk": "^0.30.0",
    
    // Protocol
    "@modelcontextprotocol/sdk": "^0.5.0",
    
    // Storage
    "better-sqlite3": "^11.0.0",
    
    // Config
    "zod": "^3.0.0",
    "yaml": "^2.0.0",
    
    // Utils
    "diff": "^5.0.0",
    "glob": "^10.0.0"
  }
}
```

---

## 13. 项目结构

> 当前实现为 TypeScript monolith（`src/`）；Go agent core / SQLite 为远期项。

```
PaCode/
├── src/
│   ├── agent/                    # Query Engine、Subagent、Plan 模式
│   │   ├── engine.ts
│   │   ├── subagent.ts
│   │   ├── plan-mode.ts
│   │   └── tool-executor.ts
│   ├── cli/                      # CLI 入口、REPL、handlers
│   │   ├── index.ts              # 主入口
│   │   ├── handlers.ts           # mcp/init/resume/worktree/cc-switch
│   │   ├── repl.ts
│   │   └── worktree.ts
│   ├── context/                  # 上下文管理
│   │   ├── assembler.ts          # 10 sources assembly
│   │   ├── compaction.ts         # 5-layer pipeline
│   │   └── session-compactor.ts
│   ├── memory/                   # 记忆系统
│   │   ├── store.ts              # 用户 + 项目双根目录
│   │   └── project.ts            # .paude/projects/{hash}/
│   ├── tools/                    # 8 核心工具 + bash-secure
│   ├── permission/               # 7 modes + classifier + tool-gate
│   ├── hooks/                    # Hook 注册与加载
│   ├── skills/                   # Skills 加载
│   ├── plugins/                  # Plugin bootstrap + tool/agent loader
│   ├── mcp/                      # MCP 客户端（stdio）
│   ├── session/                  # 会话持久化
│   └── pkg/                      # config、settings、cc-switch、app-config
│
├── plugins/                      # 插件目录（example/tools、greet.json）
├── evals/                        # Eval harness（gate + periodic）
├── test/                         # Vitest gate tests（396+）
├── docs/                         # ROADMAP 等文档
│
├── .paude/                       # 运行时数据 (gitignored)
│   ├── memory/                   # 用户级记忆
│   ├── sessions/                 # REPL 会话
│   └── projects/{hash}/          # 项目级记忆
│
├── package.json
├── tsconfig.json
├── vitest.config.ts              # 覆盖率：lines/statements 80 · functions 79 · branches 73.9
├── README.md
└── LICENSE
```

---

## 附录 A: 与 Claude Code 对比

| 特性 | Claude Code | PaCode (当前) |
|------|-------------|---------------|
| **架构** | 闭源 (~512K LOC TypeScript) | 开源 TypeScript monolith |
| **核心循环** | while-loop (~1.6% 代码) | AsyncGenerator QueryEngine ✅ |
| **记忆** | 文件-based | 文件-based + 项目 hash 分区 ✅ |
| **权限** | 7 modes + ML | 7 modes + G6/v0 deterministic AUTO + tool-gate + 工作区路径边界 ✅ |
| **压缩** | 5-layer | 5-layer L1–L5（L1 降低 API max_tokens） ✅ |
| **扩展** | Hooks/Skills/Plugins/MCP | 同上 + Ink `--tui` |
| **工具** | ~43 内置 + MCP（二手引用） | **31 核心** + Plugin + MCP；Bash 静态分析（非容器沙箱） ✅ |
| **测试** | — | `npm test`≈955（unit+gate；periodic 另跑）；覆盖率以 coverage job 为准 |
| **实现** | TypeScript (Bun) | TypeScript（Go core defer） |

---

## 附录 B: 参考资料

1. **VILA-Lab** - "Dive into Claude Code: The Design Space of Today's and Future AI Agent Systems"
   - https://github.com/VILA-Lab/Dive-into-Claude-Code
   - https://arxiv.org/html/2604.14228v1

2. **Claude Code 源码分析**
   - https://github.com/yanchuk/Claude-code-research
   - https://gist.github.com/yanchuk/0c47dd351c2805236e44ec3935e9095d

3. **社区分析**
   - https://karaxai.com/posts/how-claude-code-works-systems-deep-dive/
   - https://sidbharath.com/blog/the-anatomy-of-claude-code/
   - https://jadidbourbaki.github.io/blog/claude-code-architecture/

4. **官方文档**
   - https://code.claude.com/docs/en/mcp
   - https://cc.bruniaux.com/guide/architecture/

---

*本文档由 PaCode 团队基于 Claude Code 公开信息分析生成，仅供学习参考。*
