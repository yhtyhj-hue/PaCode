/**
 * G6 classifier contract — v0 确定性；真 ML 延后为 g6/v1-ml
 */

export const CLASSIFIER_CONTRACT = 'g6/v0-deterministic' as const;

export type ClassifierConfidence = 'high' | 'medium' | 'low';

export type ClassifierCategory =
  | 'readonly'
  | 'mutation'
  | 'bash'
  | 'external'
  | 'orchestration'
  | 'unknown';
