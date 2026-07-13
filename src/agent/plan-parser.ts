/**
 * Plan parser — 从 AI markdown 输出提取结构化 Plan
 */

import { PlanStep } from './plan-mode.js';
import { Message } from '../pkg/types.js';

const TOOL_NAMES = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Task', 'TodoWrite'];

export interface ParsedPlan {
  title: string;
  description: string;
  steps: PlanStep[];
}

/** 从 session 最后一条 assistant 消息提取纯文本 */
export function extractLastAssistantText(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'assistant') continue;

    if (typeof msg.content === 'string') return msg.content;

    const text = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
    return text || null;
  }
  return null;
}

/** 解析 AI 生成的 markdown plan */
export function parsePlanFromMarkdown(markdown: string, fallbackTitle: string): ParsedPlan {
  const lines = markdown.split('\n');

  let title = fallbackTitle;
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  if (titleMatch?.[1]) title = titleMatch[1].trim();

  const stepsStart = lines.findIndex((l) => /^##\s+steps/i.test(l.trim()));
  const descEnd = stepsStart >= 0 ? stepsStart : lines.length;
  const descLines = lines
    .slice(1, descEnd)
    .filter((l) => !l.startsWith('#') && l.trim().length > 0);
  const description = descLines.join('\n').trim() || fallbackTitle;

  const steps: PlanStep[] = [];
  const stepLines = stepsStart >= 0 ? lines.slice(stepsStart + 1) : lines;

  for (const line of stepLines) {
    const step = parseStepLine(line.trim());
    if (step) steps.push({ ...step, index: steps.length });
  }

  // 无结构化步骤时，从编号行兜底
  if (steps.length === 0) {
    for (const line of lines) {
      const m = line.match(/^\d+\.\s+(.+)/);
      if (!m?.[1]) continue;
      steps.push({
        index: steps.length,
        action: m[1].replace(/\*\*/g, '').trim().slice(0, 80),
        description: m[1].trim(),
        estimatedRisk: 'medium',
      });
    }
  }

  return { title, description, steps };
}

function parseStepLine(line: string): Omit<PlanStep, 'index'> | null {
  const numbered = line.match(/^\d+\.\s+(.+)/);
  if (!numbered?.[1]) return null;

  let rest = numbered[1];

  const risk = parseRisk(rest);
  rest = rest.replace(/🔴|🟡|🟢|\[(high|medium|low)\]/gi, '').trim();

  const boldMatch = rest.match(/\*\*([^*]+)\*\*/);
  const action = (boldMatch?.[1] ?? rest.split('—')[0] ?? rest).trim().slice(0, 80);

  const tool = parseTool(rest);
  const description = rest
    .replace(/\*\*[^*]+\*\*/g, '')
    .replace(/_\([^)]+\)_/g, '')
    .replace(/\(Read|Edit|Write|Bash|Grep|Glob|Task|TodoWrite\)/gi, '')
    .trim();

  return {
    action: action || 'Step',
    tool,
    description: description || action,
    estimatedRisk: risk,
  };
}

function parseRisk(text: string): PlanStep['estimatedRisk'] {
  if (/🔴|\bhigh\b/i.test(text)) return 'high';
  if (/🟡|\bmedium\b/i.test(text)) return 'medium';
  if (/🟢|\blow\b/i.test(text)) return 'low';
  return 'medium';
}

function parseTool(text: string): string | undefined {
  const parenTool = text.match(/_\((\w+)\)_/);
  if (parenTool?.[1]) return parenTool[1];

  const explicit = text.match(/tool:\s*(\w+)/i);
  if (explicit?.[1]) return explicit[1];

  for (const name of TOOL_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(text)) return name;
  }
  return undefined;
}
