/**
 * /effort — 映射 maxTokens 预算（非装饰文案）
 */

export type EffortLevel = 'low' | 'medium' | 'high';

/** 各档输出 token 上限 */
export const EFFORT_MAX_TOKENS: Record<EffortLevel, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
};

export function parseEffortLevel(raw: string | undefined): EffortLevel | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  return null;
}

export function effortMaxTokens(level: EffortLevel): number {
  return EFFORT_MAX_TOKENS[level];
}

export function formatEffortStatus(level: EffortLevel | undefined): string {
  const active = level ?? 'medium';
  return `effort=${active} maxTokens=${effortMaxTokens(active)} (use /effort low|medium|high)`;
}
