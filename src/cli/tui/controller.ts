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

export interface TuiLine {
  kind: TuiLineKind;
  text: string;
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
      { kind: 'system', text: `… ${dropped} earlier lines hidden` },
      ...next.slice(-MAX_TRANSCRIPT_LINES),
    ],
  };
}

function appendAssistant(state: TuiState, delta: string): TuiState {
  if (!delta) return state;
  const last = state.lines[state.lines.length - 1];
  if (last?.kind === 'assistant') {
    const updated: TuiLine = { kind: 'assistant', text: last.text + delta };
    return { ...state, lines: [...state.lines.slice(0, -1), updated] };
  }
  return pushLine(state, { kind: 'assistant', text: delta });
}

export type TuiAction =
  | { type: 'appendUser'; text: string }
  | { type: 'appendSystem'; text: string }
  | { type: 'appendError'; text: string }
  | { type: 'appendTool'; name: string; detail?: string }
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
      return pushLine(state, { kind: 'user', text: `❯ ${action.text}` });
    case 'appendSystem':
      return pushLine(state, { kind: 'system', text: action.text });
    case 'appendError':
      return pushLine(state, { kind: 'error', text: action.text });
    case 'appendTool':
      return pushLine(state, {
        kind: 'tool',
        text: action.detail ? `▸ ${action.name} ${action.detail}` : `▸ ${action.name}`,
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
  appendTool: (name: string, detail?: string): TuiAction => ({
    type: 'appendTool',
    name,
    detail,
  }),
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