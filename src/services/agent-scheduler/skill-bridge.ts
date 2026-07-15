/**
 * 意图 → Skill 注入（确定性加载，不走 LLM tool_use）
 */

import { SkillsLoader, Skill } from '../../skills/loader.js';
import { ToolIntent } from './types.js';

const INTENT_SKILL_DIRS: Partial<Record<ToolIntent, string[]>> = {
  inspect_project: ['review', 'test'],
  review_implementation: ['review', 'debug', 'refactor', 'test'],
  code_audit: ['debug', 'refactor', 'test'],
  run_tests: ['test', 'debug'],
};

export function pickSkillsForIntent(skills: Skill[], intent: ToolIntent): Skill[] {
  const dirs = INTENT_SKILL_DIRS[intent] ?? [];
  if (dirs.length === 0) return [];

  const picked: Skill[] = [];
  for (const dir of dirs) {
    const match = skills.find(
      (s) => s.source === dir || s.name.toLowerCase().replace(/\s+/g, '-') === dir
    );
    if (match && !picked.includes(match)) picked.push(match);
  }
  return picked;
}

export async function loadSkillContextForIntent(
  intent: ToolIntent
): Promise<{ loadedNames: string[]; markdown: string }> {
  const loader = new SkillsLoader();
  await loader.loadAll();
  const picked = pickSkillsForIntent(loader.list(), intent);

  if (picked.length === 0) {
    return { loadedNames: [], markdown: '' };
  }

  const loadedNames = picked.map((s) => s.source ?? s.name);
  const markdown = picked
    .map((s) => `### Skill: ${s.name}\n${s.content.trim()}`)
    .join('\n\n');

  return { loadedNames, markdown };
}
