/**
 * Token 费用估算 — 按模型表计价，未知模型标明 estimate
 */

export interface ModelPricing {
  /** USD per 1M input tokens */
  inputPerMillion: number;
  /** USD per 1M output tokens */
  outputPerMillion: number;
  /** 人类可读来源 */
  source: string;
  /** 是否为猜测/默认值 */
  isEstimate: boolean;
}

/** 公开价目表（USD / 1M tokens）。第三方网关价格可能不同。 */
const PRICING_TABLE: Array<{ match: RegExp; pricing: Omit<ModelPricing, 'isEstimate'> & { isEstimate?: boolean } }> = [
  {
    match: /opus-4|claude-opus-4|opus-4[.-]/i,
    pricing: { inputPerMillion: 15, outputPerMillion: 75, source: 'Anthropic Claude Opus 4 list' },
  },
  {
    match: /opus/i,
    pricing: { inputPerMillion: 15, outputPerMillion: 75, source: 'Anthropic Claude Opus list' },
  },
  {
    match: /haiku/i,
    pricing: { inputPerMillion: 1, outputPerMillion: 5, source: 'Anthropic Claude Haiku list' },
  },
  {
    match: /sonnet-4|claude-sonnet-4|sonnet-4[.-]/i,
    pricing: { inputPerMillion: 3, outputPerMillion: 15, source: 'Anthropic Claude Sonnet 4 list' },
  },
  {
    match: /sonnet|claude-3-5|claude-3\.5/i,
    pricing: { inputPerMillion: 3, outputPerMillion: 15, source: 'Anthropic Claude Sonnet list' },
  },
  {
    match: /minimax/i,
    pricing: {
      inputPerMillion: 0.3,
      outputPerMillion: 1.2,
      source: 'rough MiniMax-class estimate (verify with provider)',
      isEstimate: true,
    },
  },
  {
    match: /deepseek/i,
    pricing: {
      inputPerMillion: 0.28,
      outputPerMillion: 0.42,
      source: 'rough DeepSeek-class estimate (verify with provider)',
      isEstimate: true,
    },
  },
  {
    match: /glm|qwen/i,
    pricing: {
      inputPerMillion: 0.5,
      outputPerMillion: 2,
      source: 'rough GLM/Qwen-class estimate (verify with provider)',
      isEstimate: true,
    },
  },
];

const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  source: 'default Sonnet-class estimate (unknown model)',
  isEstimate: true,
};

export function resolveModelPricing(model: string): ModelPricing {
  const name = model.trim() || 'unknown';
  for (const entry of PRICING_TABLE) {
    if (entry.match.test(name)) {
      return {
        inputPerMillion: entry.pricing.inputPerMillion,
        outputPerMillion: entry.pricing.outputPerMillion,
        source: entry.pricing.source,
        isEstimate: entry.pricing.isEstimate ?? false,
      };
    }
  }
  return { ...DEFAULT_PRICING };
}

export function estimateTokenCostUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing
): number {
  return (
    (Math.max(0, inputTokens) * pricing.inputPerMillion +
      Math.max(0, outputTokens) * pricing.outputPerMillion) /
    1_000_000
  );
}

/** /cost 报告行（无 ANSI） */
export function formatCostReport(
  model: string,
  inputTokens: number,
  outputTokens: number
): string[] {
  const pricing = resolveModelPricing(model);
  const cost = estimateTokenCostUsd(inputTokens, outputTokens, pricing);
  const tag = pricing.isEstimate ? 'estimate' : 'list price';
  return [
    'Token Usage',
    `  Model:    ${model || '(unset)'}`,
    `  Input:    ${inputTokens}`,
    `  Output:   ${outputTokens}`,
    `  Total:    ${inputTokens + outputTokens}`,
    `  Rates:    $${pricing.inputPerMillion}/M in · $${pricing.outputPerMillion}/M out (${tag})`,
    `  Source:   ${pricing.source}`,
    `  Est. cost: $${cost.toFixed(4)}`,
  ];
}
