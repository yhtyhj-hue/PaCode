/**
 * tool_use / tool_result 配对修复 — API 发送前确定性 repair（结构防错，非 LLM）
 */

import { ContentBlock, Message } from '../../pkg/types.js';

const MISSING_RESULT_TEXT = '[Missing tool result]';

function extractToolUseIds(msg: Message): string[] {
  if (msg.role !== 'assistant' || typeof msg.content === 'string') return [];
  return msg.content
    .filter((b) => b.type === 'tool_use' && b.toolUse?.id)
    .map((b) => b.toolUse!.id);
}

function missingResultBlock(toolUseId: string): ContentBlock {
  return {
    type: 'tool_result',
    toolUseId,
    toolResult: {
      content: [{ type: 'text', text: MISSING_RESULT_TEXT }],
      isError: true,
    },
  };
}

function isToolResultUserMessage(msg: Message | undefined): msg is Message & { content: ContentBlock[] } {
  return (
    msg?.role === 'user' &&
    Array.isArray(msg.content) &&
    msg.content.some((b) => b.type === 'tool_result')
  );
}

/** 修复 orphan / 缺失的 tool_result，返回 API 安全消息列表 */
export function repairToolResultPairing(messages: Message[]): {
  messages: Message[];
  issues: string[];
} {
  const issues: string[] = [];
  const out: Message[] = [];

  let i = 0;
  while (i < messages.length) {
    const msg = messages[i]!;

    if (msg.role === 'system') {
      i++;
      continue;
    }

    if (msg.role === 'user') {
      if (Array.isArray(msg.content)) {
        const prev = out.at(-1);
        const toolResults = msg.content.filter((b) => b.type === 'tool_result');
        const rest = msg.content.filter((b) => b.type !== 'tool_result');

        if (toolResults.length > 0 && prev?.role !== 'assistant') {
          issues.push(`stripped ${toolResults.length} orphan tool_result block(s)`);
          if (rest.length === 0) {
            i++;
            continue;
          }
          out.push({ ...msg, content: rest });
          i++;
          continue;
        }
      }

      out.push(msg);
      i++;
      continue;
    }

    if (msg.role === 'assistant') {
      out.push(msg);
      const toolIds = extractToolUseIds(msg);

      if (toolIds.length === 0) {
        i++;
        continue;
      }

      const next = messages[i + 1];

      if (isToolResultUserMessage(next)) {
        const content = next.content;
        const byId = new Map<string, ContentBlock>();
        for (const block of content) {
          if (block.type === 'tool_result' && block.toolUseId) {
            byId.set(block.toolUseId, block);
          }
        }

        const pairedResults: ContentBlock[] = [];
        for (const id of toolIds) {
          const existing = byId.get(id);
          if (existing) {
            pairedResults.push(existing);
          } else {
            issues.push(`synthesized missing tool_result for ${id}`);
            pairedResults.push(missingResultBlock(id));
          }
        }

        const textBlocks = content.filter((b) => b.type === 'text');
        out.push({
          ...next,
          content: [...textBlocks, ...pairedResults],
        });
        i += 2;
        continue;
      }

      issues.push(`synthesized user tool_result message for ${toolIds.length} tool_use(s)`);
      out.push({
        role: 'user',
        content: toolIds.map((id) => missingResultBlock(id)),
        timestamp: msg.timestamp + 1,
      });
      i++;
      continue;
    }

    out.push(msg);
    i++;
  }

  return { messages: out, issues };
}
