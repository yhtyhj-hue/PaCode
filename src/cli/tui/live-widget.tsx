/**
 * K7 Ink — Live widget 组件(纯渲染,无 setInterval)
 *
 * Tick 由 controller.ts / app.tsx 的 useEffect 周期触发(每 1s),
 * 这里只负责把状态 → Ink <Box>/<Text>。
 *
 * 复用现有 pure 函数:
 *   - formatTaskPanelBlock (live-task-panel.ts)
 *   - formatRunningLine    (tool-running-line.ts)
 *   - query-progress 里的 phase 文案
 */

import React from 'react';
import { Box, Text } from 'ink';
import { formatTaskPanelBlock, type TaskPanelItem } from '../live-task-panel.js';

const DIM = '\x1b[2m';
const ORANGE = '\x1b[38;5;208m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

export interface ProgressWidgetProps {
  phase: string | null;
  elapsedSec: number;
  outputTokens: number;
}

/** 单行进度(Ink 直接渲染,Ink 自动处理 ANSI) */
export function ProgressWidget(props: ProgressWidgetProps): React.ReactElement | null {
  if (!props.phase) return null;
  const tokenPart =
    props.outputTokens > 0
      ? ` · ↓ ${props.outputTokens >= 1000 ? `${(props.outputTokens / 1000).toFixed(1)}k` : props.outputTokens} tokens`
      : '';
  return (
    <Box>
      <Text color="yellow">● </Text>
      <Text color="yellow">{props.phase}</Text>
      <Text dimColor>{` (${props.elapsedSec}s${tokenPart})`}</Text>
    </Box>
  );
}

export interface ToolRunningWidgetProps {
  toolName: string;
  elapsedSec: number;
  timeoutLabel: string;
  backgroundHint?: boolean;
}

export function ToolRunningWidget(props: ToolRunningWidgetProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box>
        <Text>  </Text>
        <Text color="yellow">Running…</Text>
        <Text dimColor>{` (${props.elapsedSec}s · timeout ${props.timeoutLabel})`}</Text>
      </Box>
      {props.backgroundHint && (
        <Text dimColor>{'  (use run_in_background for long jobs)'}</Text>
      )}
    </Box>
  );
}

export interface LiveTaskWidgetProps {
  items: TaskPanelItem[];
  outputTokens: number;
  elapsedSec: number;
  maxVisible?: number;
}

/**
 * 渲染多行任务树。Ink 自动处理多行 Box 布局,不需要 cursor-up escape。
 */
export function LiveTaskWidget(props: LiveTaskWidgetProps): React.ReactElement | null {
  if (props.items.length === 0) return null;
  const block = formatTaskPanelBlock(props.items, {
    elapsedSec: Math.max(1, props.elapsedSec),
    outputTokens: props.outputTokens,
    maxVisible: props.maxVisible ?? 5,
  });
  const lines = block.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <LiveTaskLine key={i} line={line} />
      ))}
    </Box>
  );
}

/** 解析单行 ANSI(Ink 也接受,但这里拆出来让 diff 干净) */
function LiveTaskLine({ line }: { line: string }): React.ReactElement {
  // 简化:透传整行(Ink 5 支持 ANSI in <Text>)
  // 颜色提示交给 Ink color prop 反而更可靠;此处保留纯文本
  return <Text>{line.replace(/\n/g, '')}</Text>;
}

/** 在 live widget 区把 3 个 widget 合并(只显示存在的) */
export interface LiveWidgetsRowProps {
  progress: ProgressWidgetProps | null;
  task: LiveTaskWidgetProps | null;
  tool: ToolRunningWidgetProps | null;
}

export function LiveWidgetsRow(props: LiveWidgetsRowProps): React.ReactElement | null {
  const { progress, task, tool } = props;
  if (!progress && !task && !tool) return null;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      {progress && <ProgressWidget {...progress} />}
      {task && <LiveTaskWidget {...task} />}
      {tool && <ToolRunningWidget {...tool} />}
    </Box>
  );
}

/** 颜色辅助常量,导出供其它 TUI 模块使用 */
export const LIVE_WIDGET_COLORS = { DIM, ORANGE, GREEN, RED };