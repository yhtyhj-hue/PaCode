/**
 * Session messages → API payload 编译器（与 UI transcript 解耦）
 */

import type Anthropic from '@anthropic-ai/sdk';
import { Message } from '../../pkg/types.js';
import { serializeMessagesForApi } from '../../agent/message-serializer.js';
import { repairToolResultPairing } from './pairing.js';

export type CompileOptions = {
  /** true 时 pairing 问题直接抛错，不 repair */
  strict?: boolean;
};

export type CompileResult = {
  messages: Anthropic.MessageParam[];
  issues: string[];
};

/** 编译 API 消息：repair pairing → serialize */
export function compileMessagesForApi(
  messages: Message[],
  options: CompileOptions = {}
): CompileResult {
  const { messages: paired, issues } = repairToolResultPairing(messages);

  if (options.strict && issues.length > 0) {
    throw new Error(`Tool pairing invalid: ${issues.join('; ')}`);
  }

  return {
    messages: serializeMessagesForApi(paired),
    issues,
  };
}
