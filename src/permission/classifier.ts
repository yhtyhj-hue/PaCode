/**
 * G6 classifier facade — routes through v1 pluggable registry (default: v0 deterministic)
 */

import { ToolCall, ToolDefinition } from '../pkg/types.js';
import type { ClassificationResult } from './classifier-contract.js';
import { getClassifierBackend } from './classifier-backend.js';

export { CLASSIFIER_CONTRACT, CLASSIFIER_REGISTRY_CONTRACT } from './classifier-contract.js';
export type {
  ClassificationResult,
  ClassifierCategory,
  ClassifierConfidence,
  RiskLevel,
} from './classifier-contract.js';
export {
  getClassifierBackend,
  setClassifierBackend,
  resetClassifierBackend,
  getClassifierRegistryContract,
  type ClassifierBackend,
} from './classifier-backend.js';
export { classifyToolCallDeterministic } from './classifier-deterministic.js';

/** Active-backend classify (tests may inject via setClassifierBackend) */
export function classifyToolCall(
  tool: ToolCall,
  definition?: ToolDefinition
): ClassificationResult {
  return getClassifierBackend().classify(tool, definition);
}
