/**
 * K7 Ink REPL shell — status + transcript + input + confirm overlay
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
  setMode: (mode: PermissionMode) => void;
  requestInterrupt: () => void;
}

export function TuiApp(props: TuiAppProps): React.ReactElement {
  const { exit } = useApp();
  const [lines, setLines] = useState<TuiLine[]>([
    {
      kind: 'system',
      text: `PaCode TUI · ${props.providerName} · ${props.model} · /exit to quit`,
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('ready');
  const [mode, setMode] = useState(props.mode);
  const [confirmQ, setConfirmQ] = useState<string | null>(null);
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  const interruptRef = useRef(false);

  const push = useCallback((line: TuiLine) => {
    setLines((prev) => truncateLines([...prev, line]));
  }, []);

  // 核心：把命令式控制器绑给 run.ts，避免 prop-drill query 循环
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
        interruptRef.current = true;
        setStatus('interrupt requested');
      },
      askConfirm: (question) =>
        new Promise<boolean>((resolve) => {
          confirmResolveRef.current = resolve;
          setConfirmQ(question);
        }),
    };
    props.bindController(ctl);
  }, [props, push]);

  useInput((ch, key) => {
    if (confirmQ) return;
    if (busy) {
      if (key.escape || (key.ctrl && ch === 'c')) {
        interruptRef.current = true;
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
      interruptRef.current = false;
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
