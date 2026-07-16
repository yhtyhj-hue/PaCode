/**
 * K3: 确定性项目 Brief（非 LLM、非核心工具）
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface BriefSection {
  name: string;
  path: string;
  present: boolean;
  excerpt: string;
}

export interface ProjectBrief {
  cwd: string;
  generatedAt: number;
  sections: BriefSection[];
  summary: string;
}

const CANDIDATES: Array<{ name: string; files: string[] }> = [
  { name: 'CLAUDE.md', files: ['CLAUDE.md', '.claude/CLAUDE.md'] },
  { name: 'package.json', files: ['package.json'] },
  { name: 'README', files: ['README.md', 'README', 'readme.md'] },
];

const MAX_EXCERPT = 4000;

function readFirst(cwd: string, files: string[]): { path: string; text: string } | null {
  for (const rel of files) {
    const abs = resolve(cwd, rel);
    if (!existsSync(abs)) continue;
    try {
      const text = readFileSync(abs, 'utf-8');
      return { path: abs, text };
    } catch {
      /* try next */
    }
  }
  return null;
}

function excerptPackageJson(raw: string): string {
  try {
    const pkg = JSON.parse(raw) as {
      name?: string;
      version?: string;
      description?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const scripts = Object.keys(pkg.scripts ?? {}).slice(0, 12);
    const deps = Object.keys(pkg.dependencies ?? {}).slice(0, 20);
    const dev = Object.keys(pkg.devDependencies ?? {}).slice(0, 15);
    return [
      `name: ${pkg.name ?? '(unnamed)'}`,
      `version: ${pkg.version ?? '?'}`,
      pkg.description ? `description: ${pkg.description}` : null,
      scripts.length ? `scripts: ${scripts.join(', ')}` : null,
      deps.length ? `dependencies (${deps.length}): ${deps.join(', ')}` : null,
      dev.length ? `devDependencies (${dev.length}): ${dev.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  } catch {
    return raw.slice(0, MAX_EXCERPT);
  }
}

/** 从 cwd 收集 CLAUDE.md / package.json / README 摘要 */
export function buildProjectBrief(cwd: string = process.cwd()): ProjectBrief {
  const root = resolve(cwd);
  const sections: BriefSection[] = [];

  for (const cand of CANDIDATES) {
    const hit = readFirst(root, cand.files);
    if (!hit) {
      sections.push({
        name: cand.name,
        path: join(root, cand.files[0]!),
        present: false,
        excerpt: '(missing)',
      });
      continue;
    }
    const body =
      cand.name === 'package.json'
        ? excerptPackageJson(hit.text)
        : hit.text.slice(0, MAX_EXCERPT);
    sections.push({
      name: cand.name,
      path: hit.path,
      present: true,
      excerpt: body,
    });
  }

  const present = sections.filter((s) => s.present).map((s) => s.name);
  const missing = sections.filter((s) => !s.present).map((s) => s.name);
  const summary = [
    `Project brief for ${root}`,
    present.length ? `Present: ${present.join(', ')}` : 'Present: (none)',
    missing.length ? `Missing: ${missing.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    cwd: root,
    generatedAt: Date.now(),
    sections,
    summary,
  };
}

/** 渲染为可注入会话的 markdown */
export function formatProjectBrief(brief: ProjectBrief): string {
  const parts = [`# Project Brief\n\n${brief.summary}\n`];
  for (const s of brief.sections) {
    parts.push(`## ${s.name}\n`);
    if (!s.present) {
      parts.push(`${s.excerpt}\n`);
      continue;
    }
    parts.push(`_Source: ${s.path}_\n\n`);
    parts.push('```\n' + s.excerpt.trimEnd() + '\n```\n');
  }
  return parts.join('\n');
}
