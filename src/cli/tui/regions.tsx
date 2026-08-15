/**
 * K7 Ink — region 组件(StatusBar / InputBox / Transcript / ModeBadge / SlashMenu)
 *
 * 复用 repl-ui.ts 的纯 formatter(formatStatusBar / formatInputAreaBlock / formatReplBorder)
 * 生成字符串,这里只把它们塞到 Ink <Text> 里。
 */

import React from 'react';
import { Box, Text } from 'ink';
import {
  formatInputPrompt,
  formatModeStatusLabel,
  formatReplBorder,
} from '../repl-ui.js';
import { PermissionMode } from '../../pkg/types.js';
import { TuiLine } from './controller.js';
import { colorForLineKind, toolIcon, formatStats, type ToolLine, type ToolStats } from './controller.js';
import { DIM, RESET } from '../repl-ui.js';

export interface InputBoxProps {
  buffer: string;
  mode: PermissionMode;
  tokens: number;
  colorizeBuffer: (text: string) => string;
  busy: boolean;
  statusOverride?: string;
  width?: number;
}

/**
 * 输入区(对齐 Claude Code):上横线 + prompt + 下横线 + 右侧状态
 *
 * 不在框内嵌入完整 status bar(mode + tokens),因为 mode badge 已经在顶层。
 * 右侧一行简短的状态提示即可。
 */
export function InputBox(props: InputBoxProps): React.ReactElement {
  const prompt = formatInputPrompt();
  const border = formatReplBorder(props.width ?? 80);
  const rightHint = props.statusOverride
    ? `${DIM}${props.statusOverride}${RESET}`
    : props.busy
    ? `${DIM}running…${RESET}`
    : '';
  const display = props.colorizeBuffer(props.buffer);
  return (
    <Box flexDirection="column">
      <Text>{border}</Text>
      <Box>
        <Text>{prompt}</Text>
        <Text>{display}</Text>
        {!props.busy && <Text inverse>{' '}</Text>}
      </Box>
      <Text>{border}</Text>
      {rightHint && <Text>{rightHint}</Text>}
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

export interface AvatarBadgeProps {
  who: 'user' | 'assistant' | 'tool' | 'system' | 'error';
}

/** 行首头像/角色徽章(对齐 Claude Code 的 You / PaCode AI 区分) */
export function AvatarBadge(props: AvatarBadgeProps): React.ReactElement {
  if (props.who === 'user') {
    return (
      <Box>
        <Text color="cyan">👤 You</Text>
      </Box>
    );
  }
  if (props.who === 'assistant') {
    return (
      <Box>
        <Text color="green">🤖 PaCode AI</Text>
      </Box>
    );
  }
  if (props.who === 'error') {
    return (
      <Box>
        <Text color="red">⚠ error</Text>
      </Box>
    );
  }
  // tool / system 不显示头像 — 已经是结构化组件
  return <Box />;
}

export interface ToolEntryRowProps {
  tool: ToolLine;
}

/**
 * 工具调用行(对齐 Claude Code):
 *   📄 Read      src/auth/session.ts                120 lines
 *   🔍 Grep      "isExpired" in src/auth            8 matches
 *   ✏️  Edit      src/auth/session.ts                +6 -2
 *   ⌨️  Bash      npm test                          1.2s · 4 passed
 *
 * 三列布局:左 icon+name | 中 path/args | 右 stats
 * 用 Box 弹性填充中间列;右对齐 stats
 */
export function ToolEntryRow(props: ToolEntryRowProps): React.ReactElement {
  const { tool } = props;
  const stats = formatStats(tool.stats);
  return (
    <Box flexDirection="row">
      <Box>
        <Text color="magenta">{`${toolIcon(tool.name)} ${tool.name}`}</Text>
      </Box>
      <Box flexGrow={1} marginLeft={1} marginRight={1}>
        <Text color="white">{tool.path ?? tool.args ?? ''}</Text>
      </Box>
      <Box>
        {stats && <Text color={statsColor(tool.stats)}>{stats}</Text>}
      </Box>
    </Box>
  );
}

/** stats 颜色:diff +/-, elapsed, lines 暗色;matches/paths 灰色 */
function statsColor(stats: ToolStats | undefined): string | undefined {
  if (!stats) return undefined;
  if (stats.kind === 'diff') return 'green';
  return 'gray';
}

/** 渲染一行 transcript:根据 kind/who 路由到合适的 region 组件 */
export function TranscriptLine({ line }: { line: TuiLine }): React.ReactElement {
  if (line.kind === 'tool' && line.tool) {
    return <ToolEntryRow tool={line.tool} />;
  }
  if (line.kind === 'user') {
    return (
      <Box flexDirection="column">
        <AvatarBadge who="user" />
        <Text color="cyan" wrap="wrap">{line.text}</Text>
      </Box>
    );
  }
  if (line.kind === 'assistant') {
    return (
      <Box flexDirection="column">
        <AvatarBadge who="assistant" />
        <Text wrap="wrap">{line.text}</Text>
      </Box>
    );
  }
  if (line.kind === 'error') {
    return (
      <Box flexDirection="column">
        <AvatarBadge who="error" />
        <Text color="red" wrap="wrap">{line.text}</Text>
      </Box>
    );
  }
  return (
    <Text color={colorForLineKind(line.kind)} wrap="wrap">
      {line.text}
    </Text>
  );
}
