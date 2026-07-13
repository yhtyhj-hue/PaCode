/**
 * Context assembler helpers — project, rules, recent results
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Message, ToolDefinition } from '../pkg/types.js';
import type { Skill } from '../skills/loader.js';

/** 合并项目与用户级 rules 目录 */
export function loadRulesLayers(): string | null {
  const parts: string[] = [];
  const dirs = [
    join(homedir(), '.claude', 'rules'),
    join(homedir(), '.paude', 'rules'),
    resolve(process.cwd(), '.claude', 'rules'),
    resolve(process.cwd(), 'rules'),
  ];

  const seen = new Set<string>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      if (seen.has(file)) continue;
      seen.add(file);
      try {
        parts.push(readFileSync(join(dir, file), 'utf-8'));
      } catch {
        /* skip */
      }
    }
  }

  return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
}

/** 从 package.json / README 提取项目上下文 */
export function loadProjectContext(): string | null {
  const parts: string[] = [];
  const pkgPath = resolve(process.cwd(), 'package.json');

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
        name?: string;
        description?: string;
        scripts?: Record<string, string>;
      };
      if (pkg.name) parts.push(`Project: ${pkg.name}`);
      if (pkg.description) parts.push(`Description: ${pkg.description}`);
      if (pkg.scripts) {
        const scripts = Object.entries(pkg.scripts)
          .slice(0, 8)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n');
        parts.push(`Scripts:\n${scripts}`);
      }
    } catch {
      /* ignore */
    }
  }

  const readmePath = resolve(process.cwd(), 'README.md');
  if (existsSync(readmePath)) {
    try {
      const readme = readFileSync(readmePath, 'utf-8');
      parts.push(`README excerpt:\n${readme.slice(0, 800)}`);
    } catch {
      /* ignore */
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

/** 最近 tool_result 摘要（Recent Results 源） */
export function formatRecentToolResults(messages: Message[], limit = 5): string | null {
  const results: string[] = [];

  for (let i = messages.length - 1; i >= 0 && results.length < limit; i--) {
    const msg = messages[i];
    if (!msg || typeof msg.content === 'string') continue;

    for (const block of msg.content) {
      if (block.type !== 'tool_result' || !block.toolResult) continue;
      const text = block.toolResult.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join(' ')
        .slice(0, 200);
      results.unshift(`- ${text || '[empty result]'}`);
    }
  }

  return results.length > 0 ? results.join('\n') : null;
}

/** Working Memory 会话摘要 */
export function formatWorkingMemory(messages: Message[]): string | null {
  if (messages.length === 0) return null;

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  let lastUserText = '';
  if (lastUser) {
    lastUserText =
      typeof lastUser.content === 'string'
        ? lastUser.content.slice(0, 300)
        : JSON.stringify(lastUser.content).slice(0, 300);
  }

  return [
    `Messages in session: ${messages.length}`,
    lastUserText ? `Last user input: ${lastUserText}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Skills 结构化目录（供 assembler 第 4 源） */
export function formatSkillsCatalog(skills: Skill[]): string | null {
  if (skills.length === 0) return null;

  const blocks = skills.map((skill) => {
    const lines: string[] = [`### ${skill.name}`];
    if (skill.description) lines.push(skill.description);
    if (skill.whenToUse.length > 0) {
      lines.push(`**When to use:** ${skill.whenToUse.join('; ')}`);
    }
    if (skill.tools.length > 0) {
      lines.push(`**Tools:** ${skill.tools.join('; ')}`);
    }
    if (skill.workflow && skill.workflow.length > 0) {
      lines.push('**Workflow:**');
      for (let i = 0; i < skill.workflow.length; i++) {
        lines.push(`${i + 1}. ${skill.workflow[i]}`);
      }
    }
    return lines.join('\n');
  });

  return [
    'Available skills — follow the matching workflow when the user task fits:',
    '',
    ...blocks,
  ].join('\n\n');
}

/** MCP + 核心工具描述摘要 */
export function formatToolCatalog(tools: ToolDefinition[]): string | null {
  if (tools.length === 0) return null;
  return tools
    .slice(0, 30)
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');
}
