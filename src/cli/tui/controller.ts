/**
 * K7 Ink TUI — TuiController 状态扩展
 *
 * 把现有 TuiController(app.tsx 中的 React state 闭包)拆出一个独立的可测试模块,
 * 暴露纯函数式状态机:行列表、busy、token、live widget 状态、模式切换。
 *
 * 设计原则:
 * - 纯函数 + Map<state, nextState>;不直接接 React/Ink;
 * - 让 app.tsx 的 useState setLines / setBusy / setStatus 通过这个 reducer 走,
 *   单元测试不需要渲染 Ink。
 */

import type { PermissionMode } from '../../pkg/types.js';
import type { TaskPanelItem } from '../live-task-panel.js';

export type TuiLineKind = 'user' | 'assistant' | 'tool' | 'system' | 'error';

/** Who produced this transcript line — drives avatar + color in UI */
export type TuiLineWho = 'user' | 'assistant' | 'tool' | 'system' | 'error';

export interface TuiLine {
  kind: TuiLineKind;
  who: TuiLineWho;
  text: string;
  /** 结构化工具行(用于 ToolEntryRow 渲染);仅 kind==='tool' 时存在 */
  tool?: ToolLine;
}

export interface TuiLiveState {
  busy: boolean;
  status: string;
  mode: PermissionMode;
  outputTokens: number;
  inputTokens: number;
  /** 当前进度阶段文案,例如 "Accomplishing…" / "Running Read" */
  progressPhase: string | null;
  /** 多行 live panel 项(由 setter 整体替换,保留 status) */
  liveTaskLines: TaskPanelItem[];
  /** 当前工具运行行(单行/双行) */
  toolRunning: { name: string; timeoutMs?: number } | null;
  /** 距上次 "busy 起始" 的秒数,渲染时算(避免每帧更新状态) */
}

export interface TuiState {
  lines: TuiLine[];
  live: TuiLiveState;
}

export const MAX_TRANSCRIPT_LINES = 200;

export function createInitialState(mode: PermissionMode): TuiState {
  return {
    lines: [],
    live: {
      busy: false,
      status: 'ready',
      mode,
      outputTokens: 0,
      inputTokens: 0,
      progressPhase: null,
      liveTaskLines: [],
      toolRunning: null,
    },
  };
}

function pushLine(state: TuiState, line: TuiLine): TuiState {
  const next = [...state.lines, line];
  if (next.length <= MAX_TRANSCRIPT_LINES) {
    return { ...state, lines: next };
  }
  const dropped = next.length - MAX_TRANSCRIPT_LINES;
  return {
    ...state,
    lines: [
      { kind: 'system', who: 'system', text: `… ${dropped} earlier lines hidden` },
      ...next.slice(-MAX_TRANSCRIPT_LINES),
    ],
  };
}

function appendAssistant(state: TuiState, delta: string): TuiState {
  if (!delta) return state;
  const last = state.lines[state.lines.length - 1];
  if (last?.kind === 'assistant') {
    const updated: TuiLine = { kind: 'assistant', who: 'assistant', text: last.text + delta };
    return { ...state, lines: [...state.lines.slice(0, -1), updated] };
  }
  return pushLine(state, { kind: 'assistant', who: 'assistant', text: delta });
}

export type ToolStats =
  | { kind: 'lines'; count: number }
  | { kind: 'matches'; count: number }
  | { kind: 'paths'; count: number }
  | { kind: 'diff'; added: number; removed: number }
  | { kind: 'elapsed'; ms: number }
  | { kind: 'note'; text: string };

export interface ToolLine {
  name: string;
  path?: string;
  args?: string;
  stats?: ToolStats;
}

export type TuiAction =
  | { type: 'appendUser'; text: string }
  | { type: 'appendSystem'; text: string }
  | { type: 'appendError'; text: string }
  | { type: 'appendTool'; tool: ToolLine }
  | { type: 'appendAssistantDelta'; delta: string }
  | { type: 'setBusy'; busy: boolean }
  | { type: 'setStatus'; status: string }
  | { type: 'setMode'; mode: PermissionMode }
  | { type: 'setProgressPhase'; phase: string | null }
  | { type: 'setLiveTaskLines'; lines: TaskPanelItem[] }
  | { type: 'setToolRunning'; running: { name: string; timeoutMs?: number } | null }
  | { type: 'addTokens'; input: number; output: number }
  | { type: 'clear' };

export function reduceTuiState(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case 'appendUser':
      return pushLine(state, { kind: 'user', who: 'user', text: `❯ ${action.text}` });
    case 'appendSystem':
      return pushLine(state, { kind: 'system', who: 'system', text: action.text });
    case 'appendError':
      return pushLine(state, { kind: 'error', who: 'error', text: action.text });
    case 'appendTool':
      return pushLine(state, {
        kind: 'tool',
        who: 'tool',
        text: formatToolLineText(action.tool),
        tool: action.tool,
      });
    case 'appendAssistantDelta':
      return appendAssistant(state, action.delta);
    case 'setBusy':
      return {
        ...state,
        live: { ...state.live, busy: action.busy, status: action.busy ? 'querying' : state.live.status },
      };
    case 'setStatus':
      return { ...state, live: { ...state.live, status: action.status } };
    case 'setMode':
      return { ...state, live: { ...state.live, mode: action.mode } };
    case 'setProgressPhase':
      return { ...state, live: { ...state.live, progressPhase: action.phase } };
    case 'setLiveTaskLines':
      return { ...state, live: { ...state.live, liveTaskLines: action.lines } };
    case 'setToolRunning':
      return { ...state, live: { ...state.live, toolRunning: action.running } };
    case 'addTokens':
      return {
        ...state,
        live: {
          ...state.live,
          inputTokens: state.live.inputTokens + action.input,
          outputTokens: state.live.outputTokens + action.output,
        },
      };
    case 'clear':
      return { ...state, lines: [] };
  }
}

/** 测试 hook:把 reducer 暴露给单测,无需 React/Ink */
export function dispatchActions(state: TuiState, actions: TuiAction[]): TuiState {
  let next = state;
  for (const action of actions) next = reduceTuiState(next, action);
  return next;
}

/** 行颜色映射 —— app.tsx 复用 */
export function colorForLineKind(kind: TuiLineKind): string | undefined {
  if (kind === 'user') return 'cyan';
  if (kind === 'tool') return 'magenta';
  if (kind === 'system') return 'gray';
  if (kind === 'error') return 'red';
  return undefined;
}

/**
 * 从 ToolCall + 文本输出里抽出"显示用"的路径/参数(中间列)
 */
export function pickToolPath(tool: { name: string; input: Record<string, unknown> }): string | undefined {
  const input = tool.input;
  if (tool.name === 'Read' || tool.name === 'Write' || tool.name === 'Edit' || tool.name === 'Glob') {
    const p = input['path'] ?? input['pattern'];
    if (typeof p === 'string') return p;
  }
  if (tool.name === 'Grep') {
    const pattern = input['pattern'];
    const path = input['path'];
    if (typeof pattern === 'string' && typeof path === 'string') return `"${pattern}" in ${path}`;
    if (typeof pattern === 'string') return `"${pattern}"`;
  }
  if (tool.name === 'Bash') {
    const cmd = input['command'];
    if (typeof cmd === 'string') return cmd.length > 60 ? `${cmd.slice(0, 57)}…` : cmd;
  }
  return undefined;
}

/**
 * 从 ToolCall + 输出文本 + 可选 elapsedMs 算 ToolStats。
 * 这是纯函数,方便单测。
 */
export function computeToolStats(
  tool: { name: string; input: Record<string, unknown> },
  outputText: string,
  elapsedMs?: number
): ToolStats | undefined {
  if (tool.name === 'Read') {
    const lines = outputText.split('\n').filter(Boolean).length;
    return { kind: 'lines', count: lines };
  }
  if (tool.name === 'Glob') {
    const count = outputText.split('\n').filter(Boolean).length;
    return { kind: 'paths', count };
  }
  if (tool.name === 'Grep') {
    const count = outputText.split('\n').filter(Boolean).length;
    return { kind: 'matches', count };
  }
  if (tool.name === 'Edit') {
    // Edit tool 把 + / - 数放在 ToolResultContent metadata 或能从 diff 解析;
    // 简化版:从 outputText 第一行匹配 "+N -M" / "+N/-M"。
    const m = /^\+(\d+)\s*-(\d+)/m.exec(outputText) ?? /^\+(\d+)\/-(\d+)/m.exec(outputText);
    if (m) {
      return { kind: 'diff', added: Number(m[1]), removed: Number(m[2]) };
    }
    return { kind: 'note', text: 'applied' };
  }
  if (tool.name === 'Bash') {
    if (typeof elapsedMs === 'number') {
      return { kind: 'elapsed', ms: elapsedMs };
    }
    return undefined;
  }
  return undefined;
}

/**
 * 工具行 emoji 图标(对齐 Claude Code)
 */
export function toolIcon(name: string): string {
  switch (name) {
    case 'Read':
      return '📄';
    case 'Edit':
      return '✏️';
    case 'Write':
      return '📝';
    case 'Bash':
      return '⌨️';
    case 'Grep':
      return '🔍';
    case 'Glob':
      return '📁';
    case 'Task':
    case 'TodoWrite':
      return '📋';
    case 'WebFetch':
      return '🌐';
    default:
      return '▸';
  }
}

/**
 * 把 ToolStats 渲染成右对齐的简短标签
 */
export function formatStats(stats: ToolStats | undefined): string {
  if (!stats) return '';
  if (stats.kind === 'lines') return `${stats.count} lines`;
  if (stats.kind === 'matches') return `${stats.count} matches`;
  if (stats.kind === 'paths') return `${stats.count} paths`;
  if (stats.kind === 'diff') {
    return `+${stats.added} -${stats.removed}`;
  }
  if (stats.kind === 'elapsed') {
    return stats.ms < 1000 ? `${stats.ms}ms` : `${(stats.ms / 1000).toFixed(1)}s`;
  }
  return stats.text;
}

/**
 * 把 ToolLine 渲染成单行字符串(TUI 内部使用 — Ink 实际渲染走 ToolEntryRow)
 */
export function formatToolLineText(tool: ToolLine): string {
  const parts = [toolIcon(tool.name), tool.name];
  if (tool.path) parts.push(tool.path);
  if (tool.args) parts.push(tool.args);
  const head = parts.join(' ');
  const stats = formatStats(tool.stats);
  return stats ? `${head}  ${stats}` : head;
}

/** 把 token 数渲染成简短字符串 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** TuiAction 构造器 — 给 reducer 用,避免每次手写 type 字段 */
export const Actions = {
  appendUser: (text: string): TuiAction => ({ type: 'appendUser', text }),
  appendSystem: (text: string): TuiAction => ({ type: 'appendSystem', text }),
  appendError: (text: string): TuiAction => ({ type: 'appendError', text }),
  appendTool: (tool: ToolLine): TuiAction => ({ type: 'appendTool', tool }),
  appendAssistantDelta: (delta: string): TuiAction => ({
    type: 'appendAssistantDelta',
    delta,
  }),
  setBusy: (busy: boolean): TuiAction => ({ type: 'setBusy', busy }),
  setStatus: (status: string): TuiAction => ({ type: 'setStatus', status }),
  setMode: (mode: PermissionMode): TuiAction => ({ type: 'setMode', mode }),
  setProgressPhase: (phase: string | null): TuiAction => ({
    type: 'setProgressPhase',
    phase,
  }),
  setLiveTasks: (lines: TaskPanelItem[]): TuiAction => ({
    type: 'setLiveTaskLines',
    lines,
  }),
  setToolRunning: (
    running: { name: string; timeoutMs?: number } | null
  ): TuiAction => ({ type: 'setToolRunning', running }),
  addTokens: (input: number, output: number): TuiAction => ({
    type: 'addTokens',
    input,
    output,
  }),
  clear: (): TuiAction => ({ type: 'clear' }),
};

/**
 * 把用户在 TUI 里做出的选择编码成 raw string,喂给 AskUser 后端的 parseAnswer。
 *
 * 规则:
 *  - single-select:返回选中的 label(option(0).label 等),parseAnswer 接受 label / id / index。
 *  - multi-select:用逗号分隔多个 label。
 *
 * 这样 CC 风格的"方向键 + Enter"交互和老 REPL 的"输入 1/2/3"路径都走同一后端。
 */
export interface AskUserChoice {
  /** 选中的 option 在原数组里的 index 列表 */
  selectedIndexes: number[];
}

export function encodeChoiceAsRaw(
  input: { options: Array<{ id: string; label: string }>; multiSelect?: boolean },
  choice: AskUserChoice
): string {
  if (!choice.selectedIndexes.length) return '';
  const labels = choice.selectedIndexes
    .map((i) => input.options[i]?.label ?? '')
    .filter(Boolean);
  return input.multiSelect ? labels.join(', ') : labels[0] ?? '';
}

/** 反向:从 raw string(老 REPL 文本输入)解析出 indexes */
export function decodeRawToIndexes(
  raw: string,
  options: Array<{ id: string; label: string }>
): number[] {
  if (!raw.trim()) return [];
  const tokens = raw.split(/[,\s]+/).filter(Boolean);
  const out: number[] = [];
  for (const t of tokens) {
    const idx = options.findIndex(
      (o) => o.id === t || o.label === t || String(options.indexOf(o) + 1) === t
    );
    if (idx >= 0 && !out.includes(idx)) out.push(idx);
  }
  return out;
}