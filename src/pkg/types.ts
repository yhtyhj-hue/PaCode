/**
 * Core Types for PaCode
 */

// Permission
export enum PermissionMode {
  PLAN = 'plan',
  DEFAULT = 'default',
  ACCEPT_EDITS = 'acceptEdits',
  AUTO = 'auto',
  DONT_ASK = 'dontAsk',
  BYPASS = 'bypassPermissions',
  BUBBLE = 'bubble',
}

export interface PermissionCheckRequest {
  tool: ToolCall;
  mode: PermissionMode;
  context: SessionState;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requiresInteraction?: boolean;
  interactionType?: 'confirm' | 'select' | 'input';
}

// Tool
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
  concurrencySafe: boolean;
  permissionMode: PermissionMode;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolContext {
  workingDirectory: string;
  sessionState: SessionState;
  hooks: HookRegistry;
  currentTool?: ToolCall;
}

export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
  preserve?: boolean;
}

export type ToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource }
  | { type: 'resource'; resource: Resource };

export interface ImageSource {
  type: 'base64' | 'url';
  mediaType: string;
  data: string;
}

export interface Resource {
  name: string;
  uri: string;
  mimeType?: string;
}

// Session
export interface SessionState {
  sessionId: string;
  messages: Message[];
  toolCallHistory: ToolCall[];
  maxOutputTokensRecoveryCount: number;
  mode: PermissionMode;
  hooks: HookConfig;
  compactionHistory: CompactionRecord[];
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
  timestamp: number;
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  toolUse?: ToolCall;
  toolUseId?: string;
  toolResult?: ToolResult;
}

export interface CompactionRecord {
  timestamp: number;
  type: CompactionType;
  beforeTokens: number;
  afterTokens: number;
}

// Query
export interface QueryRequest {
  message?: string;
  mode?: PermissionMode;
  options?: QueryOptions;
}

export interface QueryOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** auto=默认；any=必须调用至少一个工具；none=禁止模型调工具（预取后总结专用） */
  toolChoice?: 'auto' | 'any' | 'none';
  /** 预取完成后不向 API 暴露 tools，防止模型重复 Read 触发权限失败 */
  suppressTools?: boolean;
  /** 返回 true 时中止 query 循环 */
  shouldAbort?: () => boolean;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'error';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface QueryEvent {
  type:
    | 'content_block_delta'
    | 'tool_use'
    | 'tool_result'
    | 'prefetch_complete'
    | 'prefetch_progress'
    | 'skill_loaded'
    | 'agents_running'
    | 'agent_started'
    | 'agent_progress'
    | 'agent_complete'
    | 'agents_complete'
    | 'content_block_stop'
    | 'message_stop'
    | 'error';
  delta?: { index: number; text: string };
  tool?: ToolCall;
  result?: ToolResult;
  /** DAG 预取完成 — UI 只显示一行摘要 */
  prefetchTools?: ToolCall[];
  /** 预取进度 */
  prefetchDone?: number;
  prefetchTotal?: number;
  /** 已加载 skill 目录名 */
  skills?: string[];
  /** 并行 agent 快照 */
  parallelAgents?: Array<{
    id: string;
    label: string;
    agentType: string;
    status: string;
    toolCalls: number;
    currentTool?: string;
    error?: string;
  }>;
  agentId?: string;
  agentLabel?: string;
  stopReason?: StopReason;
  usage?: TokenUsage;
  error?: { code: string; message: string };
}

// Compaction
export enum CompactionType {
  BUDGET_REDUCTION = 'budget_reduction',
  SNIP = 'snip',
  MICROCOMPACT = 'microcompact',
  CONTEXT_COLLAPSE = 'context_collapse',
  AUTO_COMPACT = 'auto_compact',
}

export interface ModelContext {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  maxTokens: number;
  tokenCount: number;
  compactBoundaries?: CompactBoundary[];
}

export interface CompactBoundary {
  type: 'compact_boundary';
  summary: string;
  originalMessageCount: number;
  timestamp: number;
}

// Hooks
export enum HookType {
  PRE_TOOL_USE = 'PreToolUse',
  POST_TOOL_USE = 'PostToolUse',
  SESSION_START = 'SessionStart',
  SESSION_STOP = 'SessionStop',
  NOTIFICATION = 'Notification',
  SUBAGENT_STOP = 'SubagentStop',
}

export interface Hook {
  name: string;
  type: HookType;
  command: string | string[];
  cwd?: string;
  env?: Record<string, string>;
  matcher?: HookMatcher;
}

export interface HookMatcher {
  tool?: string;
  pattern?: string;
}

export interface HookConfig {
  hooks: Partial<Record<HookType, Hook[]>>;
}

export interface HookRegistry {
  register(hook: Hook): void;
  unregister(name: string): boolean;
  findMatching(type: HookType, context: ToolContext): Hook[];
  execute(hook: Hook): Promise<HookResult>;
  getHooks(): Hook[];
  clear(): void;
}

export interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  blocked?: boolean;
}

// MCP
export interface MCPServerConfig {
  name: string;
  type: 'stdio' | 'sse' | 'http' | 'websocket';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface MCPServerConnection {
  name: string;
  status: ConnectionStatus;
  tools: ToolDefinition[];
  lastError?: string;
}

export type ConnectionStatus = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';

// Memory
export enum MemoryType {
  PREFERENCE = 'preference',
  PATTERN = 'pattern',
  DECISION = 'decision',
  CONVENTION = 'convention',
  CODEBASE_MAP = 'codebase_map',
  ARCHITECTURE = 'architecture',
}

export interface MemoryKey {
  scope: 'user' | 'project' | 'session';
  category: string;
  id: string;
}

export interface MemoryBlock {
  key: MemoryKey;
  type: MemoryType;
  content: string;
  metadata: MemoryMetadata;
}

export interface MemoryMetadata {
  created: number;
  updated: number;
  tags: string[];
  version: number;
}
