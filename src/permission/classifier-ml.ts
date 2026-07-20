/**
 * G6 ML classifier backend — **特征启发式** + 可选 PACODE_CLASSIFIER_CMD；失败回退 deterministic
 *
 * 合同名含 ml，但实现不是神经网络；外部真模型请用 PACODE_CLASSIFIER_CMD。
 */

import { spawnSync } from 'node:child_process';
import type { ToolCall, ToolDefinition } from '../pkg/types.js';
import {
  CLASSIFIER_REGISTRY_CONTRACT,
  type ClassificationResult,
  type RiskLevel,
} from './classifier-contract.js';
import { classifyToolCallDeterministic } from './classifier-deterministic.js';

export const ML_CLASSIFIER_CONTRACT = 'g6/v1-ml-features' as const;

/** 命令/路径启发式特征 → risk + confidence */
export function scoreMlFeatures(tool: ToolCall): ClassificationResult {
  const base = classifyToolCallDeterministic(tool);
  let score = 0;
  const reasons: string[] = [];

  const name = tool.name;
  const input = (tool.input ?? {}) as Record<string, unknown>;
  const cmd = String(input['command'] ?? '');
  const path = String(input['path'] ?? input['file_path'] ?? '');

  // 破坏性 bash
  if (/rm\s+-rf|git\s+push\s+--force|DROP\s+TABLE|mkfs|dd\s+if=/i.test(cmd)) {
    score += 80;
    reasons.push('destructive_cmd');
  } else if (/git\s+(reset|checkout|clean)|chmod\s+-R|sudo/i.test(cmd)) {
    score += 45;
    reasons.push('sensitive_git_or_priv');
  }

  // 路径敏感区
  if (/\.env|credentials|id_rsa|\.pem|secrets?\//i.test(path) || /\.env|credentials/i.test(cmd)) {
    score += 35;
    reasons.push('sensitive_path');
  }

  // 命令熵：长度与特殊字符密度
  if (cmd.length > 0) {
    const special = (cmd.match(/[^a-zA-Z0-9\s._\-/]/g) ?? []).length;
    const entropy = special / Math.max(cmd.length, 1);
    if (entropy > 0.15 || cmd.length > 200) {
      score += 20;
      reasons.push('high_cmd_entropy');
    }
  }

  if (name === 'Bash' || name === 'Edit' || name === 'Write') {
    score += 10;
  }

  let risk: RiskLevel = base.risk;
  let confidence: ClassificationResult['confidence'] = 'medium';
  if (score >= 70) {
    risk = 'destructive';
    confidence = 'high';
  } else if (score >= 35) {
    risk = risk === 'safe' ? 'moderate' : risk;
    confidence = 'medium';
  } else {
    confidence = 'high';
  }

  const result: ClassificationResult = {
    risk,
    category: base.category,
    confidence,
    reason: reasons.length ? `ml_features score=${score} ${reasons.join(',')}` : base.reason,
    contract: ML_CLASSIFIER_CONTRACT,
    backend: 'ml',
  };
  auditMl(result, tool);
  return result;
}

/** 可选外部分类器：返回 JSON {risk,confidence} */
export function classifyViaExternalCmd(
  tool: ToolCall,
  command = process.env['PACODE_CLASSIFIER_CMD']
): ClassificationResult | null {
  if (!command?.trim()) return null;
  try {
    const payload = JSON.stringify({
      name: tool.name,
      input: tool.input ?? {},
    });
    const r = spawnSync(command, {
      input: payload,
      encoding: 'utf-8',
      shell: true,
      timeout: 5_000,
      env: process.env,
    });
    if (r.status !== 0 || !r.stdout?.trim()) return null;
    const parsed = JSON.parse(r.stdout.trim()) as {
      risk?: RiskLevel;
      confidence?: ClassificationResult['confidence'];
      reason?: string;
    };
    if (!parsed.risk) return null;
    const result: ClassificationResult = {
      risk: parsed.risk,
      confidence: parsed.confidence ?? 'medium',
      reason: parsed.reason ?? 'PACODE_CLASSIFIER_CMD',
      category: 'unknown',
      contract: ML_CLASSIFIER_CONTRACT,
      backend: 'ml-cmd',
    };
    auditMl(result, tool);
    return result;
  } catch {
    return null;
  }
}

function auditMl(result: ClassificationResult, tool: ToolCall): void {
  if (process.env['PACODE_CLASSIFIER_AUDIT'] !== '1') return;
  console.error(
    `[classifier ${result.contract}] backend=${result.backend} ${tool.name} risk=${result.risk} confidence=${result.confidence}${result.reason ? ` reason=${result.reason}` : ''}`
  );
}

export const mlClassifierBackend = {
  id: 'ml',
  contract: ML_CLASSIFIER_CONTRACT,
  classify(tool: ToolCall, definition?: ToolDefinition): ClassificationResult {
    try {
      const external = classifyViaExternalCmd(tool);
      if (external) return external;
      return scoreMlFeatures(tool);
    } catch (e) {
      // 失败回退 deterministic
      const fallback = classifyToolCallDeterministic(tool, definition);
      if (process.env['PACODE_CLASSIFIER_AUDIT'] === '1') {
        console.error(
          `[classifier ${CLASSIFIER_REGISTRY_CONTRACT}] ml failed; fallback deterministic: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
      return fallback;
    }
  },
};
