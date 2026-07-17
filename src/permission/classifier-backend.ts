/**
 * G6/v1: pluggable classifier registry — deterministic | ml
 */

import type { ToolCall, ToolDefinition } from '../pkg/types.js';
import {
  CLASSIFIER_REGISTRY_CONTRACT,
  type ClassificationResult,
} from './classifier-contract.js';
import { classifyToolCallDeterministic } from './classifier-deterministic.js';
import { mlClassifierBackend } from './classifier-ml.js';

export interface ClassifierBackend {
  /** Backend id (e.g. deterministic | ml) */
  id: string;
  /** Result contract stamped on each classification */
  contract: string;
  classify(tool: ToolCall, definition?: ToolDefinition): ClassificationResult;
}

const deterministicBackend: ClassifierBackend = {
  id: 'deterministic',
  contract: 'g6/v0-deterministic',
  classify: classifyToolCallDeterministic,
};

let override: ClassifierBackend | null = null;

/** Resolve active backend: test override → PACODE_CLASSIFIER → deterministic */
export function getClassifierBackend(): ClassifierBackend {
  if (override) return override;
  const raw = (process.env['PACODE_CLASSIFIER'] ?? 'deterministic').trim().toLowerCase();
  if (raw === '' || raw === 'deterministic' || raw === 'v0') {
    return deterministicBackend;
  }
  if (raw === 'ml' || raw === 'v1-ml') {
    return mlClassifierBackend;
  }
  console.error(
    `[classifier ${CLASSIFIER_REGISTRY_CONTRACT}] unknown PACODE_CLASSIFIER=${raw}; falling back to deterministic`
  );
  return deterministicBackend;
}

export function setClassifierBackend(backend: ClassifierBackend | null): void {
  override = backend;
}

export function resetClassifierBackend(): void {
  override = null;
}

export function getClassifierRegistryContract(): typeof CLASSIFIER_REGISTRY_CONTRACT {
  return CLASSIFIER_REGISTRY_CONTRACT;
}

/** 供 /permissions 展示 */
export function describeActiveClassifierBackend(): string {
  const b = getClassifierBackend();
  return `backend=${b.id} contract=${b.contract} (PACODE_CLASSIFIER / PACODE_CLASSIFIER_CMD)`;
}
