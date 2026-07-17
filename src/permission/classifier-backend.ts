/**
 * G6/v1: pluggable classifier registry — default deterministic; ML backend later
 */

import type { ToolCall, ToolDefinition } from '../pkg/types.js';
import {
  CLASSIFIER_REGISTRY_CONTRACT,
  type ClassificationResult,
} from './classifier-contract.js';
import { classifyToolCallDeterministic } from './classifier-deterministic.js';

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
  // 未知 backend 安全回退，避免误开未实现的 ML
  if (raw === 'ml' || raw === 'v1-ml') {
    console.error(
      `[classifier ${CLASSIFIER_REGISTRY_CONTRACT}] PACODE_CLASSIFIER=${raw} not implemented; falling back to deterministic`
    );
  } else {
    console.error(
      `[classifier ${CLASSIFIER_REGISTRY_CONTRACT}] unknown PACODE_CLASSIFIER=${raw}; falling back to deterministic`
    );
  }
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
