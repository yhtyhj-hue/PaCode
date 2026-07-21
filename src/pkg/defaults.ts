/**
 * 跨模块共享默认值 — MiniMax Anthropic 兼容网关（不依赖 Claude Code）
 */

/** 默认模型：MiniMax-M3 */
export const DEFAULT_MODEL = 'MiniMax-M3';

/** 国内 Anthropic 兼容端点；国际站用 https://api.minimax.io/anthropic 覆盖 */
export const DEFAULT_BASE_URL = 'https://api.minimaxi.com/anthropic';

export const DEFAULT_MAX_TOKENS = 8192;
