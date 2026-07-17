/**
 * K7 Ink REPL shell — status + transcript + input + confirm/AskUser overlays
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { PermissionMode } from '../../pkg/types.js';
import {
  appendDelta,
  formatToolLine,
  truncateLines,
  type TuiLine,
} from './frames.js';
import { ConfirmInk } from './confirm.js';
import { AskUserAbortedError } from '../../services/ask-user/index.js';

export interface TuiAppProps {
  model: string;
  mode: PermissionMode;
  providerName: string;
  onSubmit: (text: string) => Promise<void>;
  onExit: () => void;
  /** 外部注入：查询过程把行推入 */
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
  askConfirm: (question: string) => Promise<boolean>;
  /**
   * AskUser 文本提问。Esc/Ctrl+C 时 reject AskUserAbortedError（由调用方处理）。
   */
  askText: (prompt: string) => Promise<string>;
  setMode: (mode: PermissionMode) => void;
  requestInterrupt: () => void;
}

export function TuiApp(props: TuiAppProps): React.ReactElement {
  const { exit } = useApp();
  const [lines, setLines] = useState<TuiLine[]>([
    {
      kind: 'system',
      text: `PaCode TUI · ${props.providerName} · ${props.model} · /help · /exit`,
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('ready');
  const [mode, setMode] = useState(props.mode);
  const [confirmQ, setConfirmQ] = useState<string | null>(null);
  const [textPrompt, setTextPrompt] = useState<string | null>(null);
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  const textResolveRef = useRef<{
    resolve: (v: string) => void;
    reject: (e: Error) => void;
  } | null>(null);

  const push = useCallback((line: TuiLine) => {
    setLines((prev) => truncateLines([...prev, line]));
  }, []);

  useEffect(() => {
    const ctl: TuiController = {
      appendUser: (text) => push({ kind: 'user', text: `❯ ${text}` }),
      appendSystem: (text) => push({ kind: 'system', text }),
      appendError: (text) => push({ kind: 'error', text }),
      appendTool: (name, detail) => push({ kind: 'tool', text: formatToolLine(name, detail) }),
      appendAssistantDelta: (delta) => setLines((prev) => truncateLines(appendDelta(prev, delta))),
      setBusy,
      setStatus,
      setMode,
      requestInterrupt: () => {
        setStatus('interrupt requested');
      },
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
          setStatus('awaiting input');
        }),
    };
    props.bindController(ctl);
  }, [props, push]);

  useInput((ch, key) => {
    // AskUser 文本输入：即使 busy 也放行键入
    if (textPrompt) {
      if (key.escape || (key.ctrl && ch === 'c')) {
        textResolveRef.current?.reject(new AskUserAbortedError());
        textResolveRef.current = null;
        setTextPrompt(null);
        setInput('');
        setStatus(busy ? 'querying' : 'ready');
        return;
      }
      if (key.return) {
        const value = input;
        textResolveRef.current?.resolve(value);
        textResolveRef.current = null;
        setTextPrompt(null);
        setInput('');
        setStatus(busy ? 'querying' : 'ready');
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

    if (busy) {
      if (key.escape || (key.ctrl && ch === 'c')) {
        setStatus('interrupt requested');
      }
      return;
    }

    if (key.return) {
      const text = input.trim();
      setInput('');
      if (!text) return;
      if (text === '/exit' || text === '/quit') {
        props.onExit();
        exit();
        return;
      }
      void props.onSubmit(text);
      return;
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

  const colorFor = (kind: TuiLine['kind']): string | undefined => {
    if (kind === 'user') return 'cyan';
    if (kind === 'tool') return 'magenta';
    if (kind === 'system') return 'gray';
    if (kind === 'error') return 'red';
    return undefined;
  };

  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text>
          mode=<Text color="yellow">{mode}</Text> · {status}
          {busy ? ' · …' : ''}
        </Text>
      </Box>
      <Box flexDirection="column" marginY={1} height={16}>
        {lines.map((line, i) => (
          <Text key={i} color={colorFor(line.kind)} wrap="truncate">
            {line.text.replace(/\n/g, ' ')}
          </Text>
        ))}
      </Box>
      {confirmQ ? (
        <ConfirmInk
          question={confirmQ}
          onDone={(ok) => {
            confirmResolveRef.current?.(ok);
            confirmResolveRef.current = null;
            setConfirmQ(null);
          }}
        />
      ) : textPrompt ? (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text color="cyan">AskUser</Text>
          <Text>{textPrompt.replace(/\n/g, ' ').slice(0, 200)}</Text>
          <Box>
            <Text color="green">{'? '}</Text>
            <Text>{input}</Text>
            <Text dimColor>█</Text>
          </Box>
          <Text dimColor>Enter = submit · Esc = abort</Text>
        </Box>
      ) : (
        <Box>
          <Text color="green">{'> '}</Text>
          <Text>{input}</Text>
          <Text dimColor>{busy ? '' : '█'}</Text>
        </Box>
      )}
    </Box>
  );
}

/** 供测试：中断门闩 */
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
