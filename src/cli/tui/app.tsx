/**
 * K7 Ink REPL shell — status + transcript + input + confirm/AskUser overlays
 *
 * State 模型:
 *   - useReducer(reduceTuiState, props.mode) → state (lines + live)
 *   - bindController 把 dispatch action 暴露给外部(caller 用 ctl.appendXxx)
 *   - tick useEffect 每 1s 更新 elapsedSec 用于 ProgressWidget / LiveTaskWidget
 */

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { PermissionMode } from '../../pkg/types.js';
import {
  createInitialState,
  reduceTuiState,
  colorForLineKind,
  type TuiLine,
} from './controller.js';
import { ConfirmInk } from './confirm.js';
import { AskUserAbortedError } from '../../services/ask-user/index.js';
import { InputBox, SlashMenu, AskUserInputBox, AskUserChoicePrompt, ModeBadge } from './regions.js';
import {
  LiveWidgetsRow,
  type LiveTaskWidgetProps,
  type ProgressWidgetProps,
  type ToolRunningWidgetProps,
} from './live-widget.js';
import { usePasteChips } from './paste-chips.js';
import {
  filterSlashCommands,
  completeSlashCommand,
} from '../slash-menu.js';

export interface TuiAppProps {
  model: string;
  mode: PermissionMode;
  providerName: string;
  tokens?: { input: number; output: number };
  onSubmit: (text: string) => Promise<void>;
  onExit: () => void;
  /** 外部注入:查询过程把行推入 */
  bindController: (ctl: TuiController) => void;
}

export interface TuiController {
  appendUser: (text: string) => void;
  appendSystem: (text: string) => void;
  appendError: (text: string) => void;
  appendTool: (name: string, detail?: string) => void;
  appendAssistantDelta: (delta: string) => void;
  setBusy: (busy: boolean) => void;
  setStatus: (status: string) => void;
  /** 进度阶段(如 "Accomplishing…");null 隐藏 */
  setProgressPhase: (phase: string | null) => void;
  /** 多行 live task panel 行(整体替换) */
  /** 多行 live task panel — 接收 TaskPanelItem[] 保留 status 给 box icon 渲染 */
  setLiveTasks: (lines: import('../live-task-panel.js').TaskPanelItem[]) => void;
  /** 工具运行中行(null 隐藏) */
  setToolRunning: (running: { name: string; timeoutMs?: number } | null) => void;
  /** 累加 token */
  addTokens: (input: number, output: number) => void;
  askConfirm: (question: string) => Promise<boolean>;
  /** AskUser 文本提问。Esc/Ctrl+C 时 reject AskUserAbortedError(由调用方处理)。 */
  askText: (prompt: string) => Promise<string>;
  /**
   * AskUser 结构化选择(CC 同款 UI)。
   * 接收完整 input(question + options + multiSelect + default_id),返回 raw 字符串
   * (label 形式,后端 parseAnswer 解)。Esc/Ctrl+C 时 reject AskUserAbortedError。
   */
  askChoice: (input: {
    question: string;
    header?: string;
    options: Array<{ id: string; label: string; description?: string }>;
    multiSelect?: boolean;
    default_id?: string;
  }) => Promise<string>;
  setMode: (mode: PermissionMode) => void;
  requestInterrupt: () => void;
  /** 把外部文本(语音 STT 等)插入到输入框;不自动提交 */
  injectText: (text: string) => void;
}

export function TuiApp(props: TuiAppProps): React.ReactElement {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(
    reduceTuiState,
    props.mode,
    createInitialState
  );
  const [input, setInput] = useState('');
  const [confirmQ, setConfirmQ] = useState<string | null>(null);
  const [textPrompt, setTextPrompt] = useState<string | null>(null);
  const [choice, setChoice] = useState<{
    input: {
      question: string;
      header?: string;
      options: Array<{ id: string; label: string; description?: string }>;
      multiSelect?: boolean;
      default_id?: string;
    };
    selectedIndex: number;
    multiSelected: number[];
    resolve: (raw: string) => void;
    reject: (e: Error) => void;
  } | null>(null);
  const [slashSelected, setSlashSelected] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const [toolRunningStart, setToolRunningStart] = useState<number | null>(null);
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  const textResolveRef = useRef<{
    resolve: (v: string) => void;
    reject: (e: Error) => void;
  } | null>(null);
  const interruptRef = useRef<(() => void) | null>(null);
  const paste = usePasteChips();

  // 1Hz tick:更新 elapsed,驱动 ProgressWidget / LiveTaskWidget
  useEffect(() => {
    if (!state.live.busy) {
      setElapsedSec(0);
      return;
    }
    setBusyStartedAt((prev) => prev ?? Date.now());
    const id = setInterval(() => {
      if (busyStartedAt) setElapsedSec(Math.floor((Date.now() - busyStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [state.live.busy, busyStartedAt]);

  // bindController
  useEffect(() => {
    const ctl: TuiController = {
      appendUser: (text) => dispatch({ type: 'appendUser', text }),
      appendSystem: (text) => dispatch({ type: 'appendSystem', text }),
      appendError: (text) => dispatch({ type: 'appendError', text }),
      appendTool: (name, detail) => dispatch({ type: 'appendTool', name, detail }),
      appendAssistantDelta: (delta) => dispatch({ type: 'appendAssistantDelta', delta }),
      setBusy: (busy) => {
        dispatch({ type: 'setBusy', busy });
        if (busy) setBusyStartedAt(Date.now());
        else setBusyStartedAt(null);
      },
      setStatus: (status) => dispatch({ type: 'setStatus', status }),
      setProgressPhase: (phase) => dispatch({ type: 'setProgressPhase', phase }),
      setLiveTasks: (lines) => dispatch({ type: 'setLiveTaskLines', lines }),
      setToolRunning: (running) => {
        dispatch({ type: 'setToolRunning', running });
        setToolRunningStart(running ? Date.now() : null);
      },
      addTokens: (input, output) => dispatch({ type: 'addTokens', input, output }),
      askConfirm: (question) =>
        new Promise<boolean>((resolve) => {
          confirmResolveRef.current = resolve;
          setConfirmQ(question);
        }),
      askText: (prompt) =>
        new Promise<string>((resolve, reject) => {
          textResolveRef.current = { resolve, reject };
          setTextPrompt(prompt);
          setInput('');
          dispatch({ type: 'setStatus', status: 'awaiting input' });
        }),
      askChoice: (askInput) =>
        new Promise<string>((resolve, reject) => {
          setChoice({
            input: askInput,
            selectedIndex: 0,
            multiSelected: [],
            resolve,
            reject,
          });
          dispatch({ type: 'setStatus', status: 'awaiting choice' });
        }),
      setMode: (mode) => dispatch({ type: 'setMode', mode }),
      requestInterrupt: () => {
        dispatch({ type: 'setStatus', status: 'interrupt requested' });
        interruptRef.current?.();
      },
      injectText: (text) => {
        // 仅插入,不自动 Enter(用户决策)
        if (!text) return;
        setInput((s) => s + text);
      },
    };
    props.bindController(ctl);
  }, [props]);

  const slashEntries = useMemo(
    () => filterSlashCommands(input),
    [input]
  );

  const submit = useCallback(
    (text: string): void => {
      if (!text) return;
      if (text === '/exit' || text === '/quit') {
        props.onExit();
        exit();
        return;
      }
      void props.onSubmit(text);
    },
    [props, exit]
  );

  useInput((ch, key) => {
    // AskUser 文本输入:即使 busy 也放行键入
    if (textPrompt) {
      if (key.escape || (key.ctrl && ch === 'c')) {
        textResolveRef.current?.reject(new AskUserAbortedError());
        textResolveRef.current = null;
        setTextPrompt(null);
        setInput('');
        dispatch({ type: 'setStatus', status: state.live.busy ? 'querying' : 'ready' });
        return;
      }
      if (key.return) {
        const value = input;
        textResolveRef.current?.resolve(value);
        textResolveRef.current = null;
        setTextPrompt(null);
        setInput('');
        dispatch({ type: 'setStatus', status: state.live.busy ? 'querying' : 'ready' });
        return;
      }
      if (key.backspace || key.delete) {
        setInput((s) => s.slice(0, -1));
        return;
      }
      if (ch && !key.ctrl && !key.meta) {
        setInput((s) => s + ch);
      }
      return;
    }

    if (confirmQ) return;

    // AskUser 选择题(CC 同款):方向键/数字键/空格/Enter/Esc
    if (choice) {
      if (key.escape || (key.ctrl && ch === 'c')) {
        const { reject } = choice;
        setChoice(null);
        dispatch({ type: 'setStatus', status: state.live.busy ? 'querying' : 'ready' });
        reject(new AskUserAbortedError());
        return;
      }
      if (key.upArrow) {
        setChoice((c) =>
          c
            ? { ...c, selectedIndex: c.selectedIndex <= 0 ? c.input.options.length - 1 : c.selectedIndex - 1 }
            : c
        );
        return;
      }
      if (key.downArrow) {
        setChoice((c) =>
          c
            ? { ...c, selectedIndex: (c.selectedIndex + 1) % c.input.options.length }
            : c
        );
        return;
      }
      if (choice.input.multiSelect && ch === ' ') {
        setChoice((c) => {
          if (!c) return c;
          const idx = c.selectedIndex;
          const has = c.multiSelected.includes(idx);
          const nextMulti = has
            ? c.multiSelected.filter((i) => i !== idx)
            : [...c.multiSelected, idx];
          return { ...c, multiSelected: nextMulti };
        });
        return;
      }
      // 数字键快捷(单选):1-9 直接跳到对应项
      if (!choice.input.multiSelect && ch && /^[1-9]$/.test(ch)) {
        const idx = Number.parseInt(ch, 10) - 1;
        if (idx >= 0 && idx < choice.input.options.length) {
          setChoice((c) => (c ? { ...c, selectedIndex: idx } : c));
        }
      }
      if (key.return) {
        const { resolve, input: askInput, selectedIndex, multiSelected } = choice;
        const indexes = askInput.multiSelect
          ? multiSelected.includes(selectedIndex)
            ? multiSelected
            : [...multiSelected, selectedIndex]
          : [selectedIndex];
        const labels = indexes
          .map((i) => askInput.options[i]?.label ?? '')
          .filter(Boolean);
        const raw = askInput.multiSelect ? labels.join(', ') : labels[0] ?? '';
        setChoice(null);
        dispatch({ type: 'setStatus', status: state.live.busy ? 'querying' : 'ready' });
        resolve(raw);
        return;
      }
      return;
    }

    if (state.live.busy) {
      if (key.escape || (key.ctrl && ch === 'c')) {
        dispatch({ type: 'setStatus', status: 'interrupt requested' });
        interruptRef.current?.();
      }
      return;
    }

    if (key.return) {
      const text = paste.expandForSubmit(input).trim();
      setInput('');
      setSlashSelected(0);
      if (!text) return;
      submit(text);
      return;
    }

    if (key.tab && input.startsWith('/')) {
      const completed = completeSlashCommand(input);
      if (completed) {
        setInput(completed);
        return;
      }
    }

    // Slash menu 上下选择
    if (slashEntries.length > 0 && input.startsWith('/')) {
      if (key.upArrow) {
        setSlashSelected((i) => (i <= 0 ? slashEntries.length - 1 : i - 1));
        return;
      }
      if (key.downArrow) {
        setSlashSelected((i) => (i + 1) % slashEntries.length);
        return;
      }
    }

    if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1));
      return;
    }

    if (key.ctrl && ch === 'c') {
      props.onExit();
      exit();
      return;
    }

    if (ch && !key.ctrl && !key.meta) {
      setInput((s) => s + ch);
    }
  });

  // 把 hook interruptRef 暴露给 caller —— run.tsx 在 bindController 时 wire
  useEffect(() => {
    interruptRef.current = () => {
      // 默认:仅更新 status;具体行为由 run.tsx 通过 wrap ctl.requestInterrupt 注入
    };
  }, []);

  // Live widget props
  const totalTokens = (props.tokens?.output ?? state.live.outputTokens) || 0;
  const progressProps: ProgressWidgetProps | null = state.live.progressPhase
    ? {
        phase: state.live.progressPhase,
        elapsedSec: Math.max(1, elapsedSec),
        outputTokens: state.live.outputTokens,
      }
    : null;
  const taskProps: LiveTaskWidgetProps | null =
    state.live.liveTaskLines.length > 0
      ? {
          items: state.live.liveTaskLines,
          outputTokens: state.live.outputTokens,
          elapsedSec: Math.max(1, elapsedSec),
        }
      : null;
  const toolProps: ToolRunningWidgetProps | null = state.live.toolRunning
    ? {
        toolName: state.live.toolRunning.name,
        elapsedSec: toolRunningStart
          ? Math.max(1, Math.floor((Date.now() - toolRunningStart) / 1000))
          : 1,
        timeoutLabel:
          state.live.toolRunning.timeoutMs !== undefined
            ? state.live.toolRunning.timeoutMs >= 60_000
              ? `${Math.round(state.live.toolRunning.timeoutMs / 60_000)}m`
              : `${Math.round(state.live.toolRunning.timeoutMs / 1000)}s`
            : '1m',
      }
    : null;

  return (
    <Box flexDirection="column" width="100%">
      {/* 顶部:mode badge(一行,跟 Claude Code 一致) */}
      <ModeBadge mode={state.live.mode} />

      {/* Live widgets 区块:仅在 busy 时显示 */}
      {state.live.busy && (
        <LiveWidgetsRow progress={progressProps} task={taskProps} tool={toolProps} />
      )}

      {/*
        Transcript:flexGrow=1 占据除输入框外的所有剩余空间,overflow=hidden 把
        溢出行裁掉而不是向下推输入框(否则长 transcript 会盖住输入区)。
        flexShrink=0 让它不被挤掉。
      */}
      <Box flexDirection="column" marginY={1} flexGrow={1} flexShrink={0} overflow="hidden">
        {state.lines.map((line, i) => (
          <Text key={i} color={colorForLineKind(line.kind)} wrap="truncate">
            {line.text.replace(/\n/g, ' ')}
          </Text>
        ))}
      </Box>

      {/* Slash menu(输入以 / 开头时显示) */}
      {input.startsWith('/') && slashEntries.length > 0 && (
        <SlashMenu entries={slashEntries} selectedIndex={slashSelected} />
      )}

      {/* 输入区:choice > confirm > AskUser 文本 > 普通输入 四态 */}
      {choice ? (
        <AskUserChoicePrompt
          header={choice.input.header}
          question={choice.input.question}
          options={choice.input.options}
          selectedIndex={choice.selectedIndex}
          multiSelected={choice.multiSelected}
          multiSelect={Boolean(choice.input.multiSelect)}
          defaultId={choice.input.default_id}
        />
      ) : confirmQ ? (
        <ConfirmInk
          question={confirmQ}
          onDone={(ok) => {
            confirmResolveRef.current?.(ok);
            confirmResolveRef.current = null;
            setConfirmQ(null);
          }}
        />
      ) : textPrompt ? (
        <AskUserInputBox
          prompt={textPrompt}
          buffer={input}
        />
      ) : (
        <InputBox
          buffer={input}
          mode={state.live.mode}
          tokens={totalTokens}
          colorizeBuffer={paste.colorize}
          busy={state.live.busy}
          statusOverride={
            paste.hasCollapsed(input) ? 'paste again to expand' : undefined
          }
        />
      )}
    </Box>
  );
}

/** 供测试:中断门闩 */
export function createInterruptGate(): {
  shouldAbort: () => boolean;
  trip: () => void;
  reset: () => void;
} {
  let aborted = false;
  return {
    shouldAbort: () => aborted,
    trip: () => {
      aborted = true;
    },
    reset: () => {
      aborted = false;
    },
  };
}

/** 类型导出供 slash / regions 复用 */
export type { TuiLine };