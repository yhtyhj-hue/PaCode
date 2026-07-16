/**
 * K5: 为远程 MCP（sse/http）注入已保存的 OAuth Bearer（若有）
 */

import { createFileTokenStore } from '../services/mcp-auth/index.js';
import type { TokenStore } from '../services/mcp-auth/index.js';
import { isExpired } from '../services/mcp-auth/index.js';

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return url.trim().replace(/\/$/, '');
  }
}

/**
 * 若 token store 中有匹配 server_url 的未过期 session，合并 Authorization。
 * 已有 Authorization 头则不覆盖。失败时静默返回原 headers。
 */
export async function mergeMcpAuthHeaders(
  url: string | undefined,
  headers?: Record<string, string>,
  store?: TokenStore
): Promise<Record<string, string> | undefined> {
  const base = { ...(headers ?? {}) };
  if (!url) return Object.keys(base).length ? base : undefined;

  const hasAuth = Object.keys(base).some((k) => k.toLowerCase() === 'authorization');
  if (hasAuth) return base;

  try {
    const tokenStore = store ?? createFileTokenStore();
    const summaries = await tokenStore.list();
    const target = normalizeUrl(url);
    const match = summaries.find((s) => {
      const stored = normalizeUrl(s.server_url);
      return target === stored || target.startsWith(stored + '/') || stored.startsWith(target);
    });
    if (!match) return Object.keys(base).length ? base : undefined;

    const session = await tokenStore.load(match.server_url, match.client_id);
    if (!session?.access_token) return Object.keys(base).length ? base : undefined;
    if (isExpired(session)) return Object.keys(base).length ? base : undefined;

    return {
      ...base,
      Authorization: `Bearer ${session.access_token}`,
    };
  } catch {
    return Object.keys(base).length ? base : undefined;
  }
}
