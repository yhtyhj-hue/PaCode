/**
 * K7 Ink — region 组件(StatusBar / InputBox / Transcript / ModeBadge / SlashMenu)
 *
 * 复用 repl-ui.ts 的纯 formatter(formatStatusBar / formatInputAreaBlock / formatReplBorder)
 * 生成字符串,这里只把它们塞到 Ink <Text> 里。
 */

import React from 'react';
import { Box, Text } from 'ink';
import {
  formatStatusBar,
  formatInputPrompt,
  formatModeStatusLabel,
  formatReplBorder,
} from '../repl-ui.js';
import type { StatuslineContext } from '../statusline.js';
import { PermissionMode } from '../../pkg/types.js';
import type { TuiLine } from './controller.js';
import { colorForLineKind } from './controller.js';

export interface StatusBarProps {
  mode: PermissionMode;
  tokens: number;
  status: string;
  width?: number;
  statuslineCtx?: Omit<StatuslineContext, 'mode' | 'tokens'>;
}

export function StatusBar(props: StatusBarProps): React.ReactElement {
  const line = formatStatusBar(
    props.mode,
    props.tokens,
    props.width ?? 80,
    props.statuslineCtx
  );
  // 拆 ANSI 序列:Ink 会自动重渲染颜色,但 status 字段被嵌在右侧 token 之前。
  // 这里直接当纯文本渲染(颜色由 formatStatusBar 内置 ANSI 完成)。
  return (
    <Box>
      <Text>{line}</Text>
    </Box>
  );
}

export interface InputBoxProps {
  buffer: string;
  mode: PermissionMode;
  tokens: number;
  colorizeBuffer: (text: string) => string;
  busy: boolean;
  statusOverride?: string;
  width?: number;
}

export function InputBox(props: InputBoxProps): React.ReactElement {
  const prompt = formatInputPrompt();
  const border = formatReplBorder(props.width ?? 80);
  const status =
    props.statusOverride ??
    formatStatusBar(props.mode, props.tokens, props.width ?? 80);
  const display = props.colorizeBuffer(props.buffer);
  return (
    <Box flexDirection="column">
      <Text>{border}</Text>
      <Box>
        <Text>{prompt}</Text>
        <Text>{display}</Text>
        {!props.busy && <Text dimColor>█</Text>}
      </Box>
      <Text>{border}</Text>
      <Text>{status}</Text>
    </Box>
  );
}

export interface TranscriptProps {
  lines: TuiLine[];
  /** 固定显示高度(行数);超出滚动由父层 Box height 控制 */
  height?: number;
}

/** 单行化展示:把 \n 折叠为空格,避免破坏 alt-screen 区域对齐 */
function flatten(text: string): string {
  return text.replace(/\n/g, ' ').replace(/\r/g, '');
}

export function Transcript(props: TranscriptProps): React.ReactElement {
  const lines = props.lines;
  return (
    <Box flexDirection="column" height={props.height ?? 16}>
      {lines.map((line, i) => (
        <Text key={i} color={colorForLineKind(line.kind)} wrap="truncate">
          {flatten(line.text)}
        </Text>
      ))}
    </Box>
  );
}

export interface ModeBadgeProps {
  mode: PermissionMode;
}

export function ModeBadge(props: ModeBadgeProps): React.ReactElement {
  const label = formatModeStatusLabel(props.mode);
  return (
    <Box>
      <Text color="green">❯❯</Text>
      <Text> </Text>
      <Text color="green">{label}</Text>
    </Box>
  );
}

export interface SlashMenuProps {
  entries: Array<{ command: string; description: string }>;
  selectedIndex: number;
}

/** 简化版菜单(供 TUI 使用,Ink 不直接渲染 ANSI escape,改用 Ink 颜色) */
export function SlashMenu(props: SlashMenuProps): React.ReactElement | null {
  if (props.entries.length === 0) return null;
  const shown = props.entries.slice(0, 8);
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {shown.map((entry, i) => {
        const selected = i === props.selectedIndex;
        return (
          <Box key={entry.command}>
            <Text color={selected ? 'green' : 'gray'}>{selected ? '❯ ' : '  '}</Text>
            <Text color={selected ? 'cyan' : undefined} bold={selected}>
              {entry.command.padEnd(14)}
            </Text>
            <Text dimColor={!selected}> {entry.description}</Text>
          </Box>
        );
      })}
      {props.entries.length > shown.length && (
        <Text dimColor>… {props.entries.length - shown.length} more — type to filter</Text>
      )}
    </Box>
  );
}

export interface AskUserInputBoxProps {
  prompt: string;
  buffer: string;
}

/**
 * AskUser 提问时的输入框。
 *
 * 关键:不要给 <Box> 加 width prop —— Ink 会让 round 边框撑满父容器宽度,
 * 看起来像一整片横线。边框宽度必须跟随内容。
 */
export function AskUserInputBox(props: AskUserInputBoxProps): React.ReactElement {
  const promptText = props.prompt.replace(/\n/g, ' ').slice(0, 200);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} flexShrink={0}>
      <Text color="cyan" bold>AskUser</Text>
      <Text>{promptText}</Text>
      <Box>
        <Text color="green" bold>{'? '}</Text>
        <Text color="white">{props.buffer}</Text>
        {/* 反色光标:在大多数终端对比度足够,明确"可输入" */}
        <Text inverse>{' '}</Text>
      </Box>
      <Text dimColor>Enter = submit · Esc = abort</Text>
    </Box>
  );
}

export interface AskUserChoicePromptProps {
  /** 用户问题的简短 header(CC 风格,≤12 字符) */
  header?: string;
  question: string;
  options: Array<{ id: string; label: string; description?: string }>;
  /** 当前光标位置(单选) */
  selectedIndex: number;
  /** multiSelect 模式下已选项的 index 集合 */
  multiSelected: number[];
  multiSelect: boolean;
  defaultId?: string;
}

/**
 * AskUser 选择题(CC 同款):header chip + question + 编号列表 + 选中态高亮
 *
 * 视觉对齐 Claude Code:
 *  - header 顶部框(青色)
 *  - 编号 1)/2)/3)... + label + 可选 description
 *  - 当前光标行用青色 + 加粗高亮
 *  - 多选用 checkbox □/■
 */
export function AskUserChoicePrompt(props: AskUserChoicePromptProps): React.ReactElement {
  const tag = props.multiSelect ? 'multiSelect' : 'select';
  const headerText = props.header ? `${props.header} [${tag}]` : `[${tag}]`;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} flexShrink={0}>
      <Text color="cyan" bold>{headerText}</Text>
      <Text>{props.question}</Text>
      {props.options.map((opt, idx) => {
        const isCursor = idx === props.selectedIndex;
        const isMultiChecked = props.multiSelect && props.multiSelected.includes(idx);
        const marker = props.multiSelect ? (isMultiChecked ? '■' : '☐') : '';
        const number = props.multiSelect ? '' : `${idx + 1})`;
        const labelColor = isCursor ? 'cyan' : 'white';
        return (
          <Box key={opt.id}>
            {props.multiSelect ? (
              <Text color={isCursor ? 'cyan' : undefined}>{`  ${marker} `}</Text>
            ) : (
              <Text color={isCursor ? 'cyan' : undefined}>{`  ${number.padEnd(3)} `}</Text>
            )}
            <Text color={labelColor} bold={isCursor}>
              {opt.label}
            </Text>
            {opt.description && <Text dimColor>{` — ${opt.description}`}</Text>}
          </Box>
        );
      })}
      {props.defaultId !== undefined && !props.multiSelect && (
        <Text dimColor>{`  default: ${props.options.find((o) => o.id === props.defaultId)?.label ?? props.defaultId}`}</Text>
      )}
      <Text dimColor>
        {props.multiSelect
          ? '↑/↓ to move · space to toggle · enter to confirm · esc to abort'
          : '↑/↓ to move · enter to confirm · 1-9 shortcut · esc to abort'}
      </Text>
    </Box>
  );
}
