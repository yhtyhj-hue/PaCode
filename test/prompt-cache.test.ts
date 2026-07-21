import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  withSystemCache,
  withToolsCache,
  withMessagesCache,
  EPHEMERAL_CACHE,
} from '../src/agent/prompt-cache.js';

describe('prompt-cache', () => {
  describe('withSystemCache', () => {
    it('converts a string system prompt to a cached text block', () => {
      const result = withSystemCache('You are PaCode.');
      expect(result).toEqual([
        { type: 'text', text: 'You are PaCode.', cache_control: EPHEMERAL_CACHE },
      ]);
    });

    it('returns undefined for empty/undefined system prompt', () => {
      expect(withSystemCache('')).toBeUndefined();
      expect(withSystemCache(undefined)).toBeUndefined();
    });
  });

  describe('withToolsCache', () => {
    it('marks only the last tool with cache_control', () => {
      const tools: Anthropic.Messages.Tool[] = [
        { name: 'Read', description: 'read', input_schema: { type: 'object' } },
        { name: 'Bash', description: 'bash', input_schema: { type: 'object' } },
      ];
      const result = withToolsCache(tools);
      expect(result[0]).not.toHaveProperty('cache_control');
      expect((result[1] as { cache_control?: unknown }).cache_control).toEqual(EPHEMERAL_CACHE);
    });

    it('does not mutate the input array', () => {
      const tools: Anthropic.Messages.Tool[] = [
        { name: 'Read', description: 'read', input_schema: { type: 'object' } },
      ];
      withToolsCache(tools);
      expect((tools[0] as { cache_control?: unknown }).cache_control).toBeUndefined();
    });

    it('returns empty array unchanged', () => {
      expect(withToolsCache([])).toEqual([]);
    });
  });

  describe('withMessagesCache', () => {
    it('marks the last block of the last message (array content)', () => {
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: 'first' },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
          ],
        },
      ];
      const result = withMessagesCache(messages);
      const last = result[1]!.content as Array<{ cache_control?: unknown }>;
      expect(last[0]!.cache_control).toEqual(EPHEMERAL_CACHE);
    });

    it('converts a trailing string content into a cached text block', () => {
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'hello' }];
      const result = withMessagesCache(messages);
      expect(result[0]!.content).toEqual([
        { type: 'text', text: 'hello', cache_control: EPHEMERAL_CACHE },
      ]);
    });

    it('does not mutate the input messages', () => {
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'hello' }];
      withMessagesCache(messages);
      expect(messages[0]!.content).toBe('hello');
    });

    it('returns empty array unchanged', () => {
      expect(withMessagesCache([])).toEqual([]);
    });
  });
});
