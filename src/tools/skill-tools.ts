/**
 * K1: SkillTool + ToolSearch — 延迟加载技能 / 搜索已注册工具
 */

import { ToolDefinition, PermissionMode } from '../pkg/types.js';
import { ToolRegistry } from './registry.js';
import { SkillsLoader } from '../skills/loader.js';

export interface SkillToolsDeps {
  skillsLoader?: SkillsLoader;
  toolRegistry: ToolRegistry;
}

function scoreTool(query: string, name: string, description: string): number {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  const d = description.toLowerCase();
  let score = 0;
  if (n === q) score += 100;
  else if (n.startsWith(q)) score += 80;
  else if (n.includes(q)) score += 60;
  if (d.includes(q)) score += 20;
  for (const token of q.split(/\s+/).filter(Boolean)) {
    if (n.includes(token)) score += 10;
    if (d.includes(token)) score += 5;
  }
  return score;
}

export function searchTools(
  registry: ToolRegistry,
  query: string,
  limit = 10
): Array<{ name: string; description: string; score: number }> {
  const q = query.trim();
  if (!q) return [];
  const scored = registry
    .list()
    .map((t) => ({
      name: t.name,
      description: t.description,
      score: scoreTool(q, t.name, t.description),
    }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, Math.max(1, Math.min(limit, 50)));
}

export function registerSkillTools(
  registry: { register: (t: ToolDefinition) => void },
  deps: SkillToolsDeps
): void {
  const getLoader = (): SkillsLoader => deps.skillsLoader ?? new SkillsLoader();

  registry.register({
    name: 'SkillTool',
    description:
      'Load a project skill by id/name (full SKILL.md). Use action=list for the index. Prefer this over guessing workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['load', 'list', 'search'],
          description: 'load (default) | list | search',
        },
        name: { type: 'string', description: 'Skill id or display name (load)' },
        query: { type: 'string', description: 'Fuzzy query (load/search)' },
      },
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const {
        action = 'load',
        name,
        query,
      } = input as { action?: 'load' | 'list' | 'search'; name?: string; query?: string };

      const loader = getLoader();
      if (loader.list().length === 0) {
        await loader.loadAll();
      }

      if (action === 'list') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ skills: loader.listIndex() }, null, 2),
            },
          ],
        };
      }

      if (action === 'search') {
        const q = query ?? name ?? '';
        if (!q.trim()) {
          return {
            content: [{ type: 'text', text: 'query required for search' }],
            isError: true,
          };
        }
        const hits = loader.match(q).map((s) => ({
          id: s.source ?? s.name,
          name: s.name,
          description: s.description,
          whenToUse: s.whenToUse,
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify({ query: q, skills: hits }, null, 2) }],
        };
      }

      // load
      const key = (name ?? query ?? '').trim();
      if (!key) {
        return {
          content: [
            {
              type: 'text',
              text: 'name or query required for load. Use action=list to see indexed skills.',
            },
          ],
          isError: true,
        };
      }

      let skill = loader.resolve(key);
      if (!skill) {
        const hits = loader.match(key);
        if (hits.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Skill not found: ${key}. Indexed: ${loader
                  .listIndex()
                  .map((s) => s.id)
                  .join(', ')}`,
              },
            ],
            isError: true,
          };
        }
        if (hits.length > 1) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    ambiguous: true,
                    query: key,
                    candidates: hits.map((s) => ({
                      id: s.source ?? s.name,
                      name: s.name,
                      description: s.description,
                    })),
                    hint: 'Call SkillTool again with an exact id',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
        skill = hits[0]!;
      }

      // 核心：返回完整 SKILL.md，供模型按 workflow 执行
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                id: skill.source ?? skill.name,
                name: skill.name,
                description: skill.description,
                whenToUse: skill.whenToUse,
                tools: skill.tools,
                workflow: skill.workflow ?? [],
                content: skill.content,
              },
              null,
              2
            ),
          },
        ],
      };
    },
  });

  registry.register({
    name: 'ToolSearch',
    description:
      'Search registered tools (and optionally skills) by name/description. Does not execute tools.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max tool results (default 10)' },
        include_skills: {
          type: 'boolean',
          description: 'Also search skill index (default false)',
        },
      },
      required: ['query'],
    },
    concurrencySafe: true,
    permissionMode: PermissionMode.DEFAULT,
    async execute(input) {
      const {
        query,
        limit = 10,
        include_skills: includeSkills = false,
      } = input as { query: string; limit?: number; include_skills?: boolean };

      const tools = searchTools(deps.toolRegistry, query, limit);
      const result: Record<string, unknown> = {
        query,
        tools: tools.map(({ name, description, score }) => ({ name, description, score })),
      };

      if (includeSkills) {
        const loader = getLoader();
        if (loader.list().length === 0) await loader.loadAll();
        result.skills = loader.match(query).map((s) => ({
          id: s.source ?? s.name,
          name: s.name,
          description: s.description,
        }));
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  });
}
