/**
 * G6 classifier contracts — v0 确定性结果；v1 可插拔注册表；真 ML 延后
 */

export const CLASSIFIER_CONTRACT = 'g6/v0-deterministic' as const;
export const CLASSIFIER_REGISTRY_CONTRACT = 'g6/v1-pluggable' as const;

export type ClassifierConfidence = 'high' | 'medium' | 'low';

export type ClassifierCategory =
  | 'readonly'
  | 'mutation'
  | 'bash'
  | 'external'
  | 'orchestration'
  | 'unknown';

export type RiskLevel = 'safe' | 'moderate' | 'destructive';

export interface ClassificationResult {
  risk: RiskLevel;
  reason?: string;
  /** Per-classification contract (usually g6/v0-deterministic) */
  contract?: string;
  category?: ClassifierCategory;
  confidence?: ClassifierConfidence;
  /** Active backend id from registry */
  backend?: string;
}
