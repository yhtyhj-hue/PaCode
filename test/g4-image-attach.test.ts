/**
 * G4: 多模态图片 — 加载 + 序列化进 API messages
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadImageFromFile, imageFromUrl, mediaTypeFromPath } from '../src/services/image-attach/index.js';
import {
  serializeMessagesForApi,
  serializeImageSource,
} from '../src/agent/message-serializer.js';
import { attachImagesToLatestUserMessage } from '../src/agent/engine.js';
import { PermissionMode, type Message } from '../src/pkg/types.js';

/** 1x1 PNG */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('G4 image-attach', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'g4-img-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads png file to base64 ImageSource', () => {
    const path = join(dir, 'a.png');
    writeFileSync(path, TINY_PNG);
    const img = loadImageFromFile(path, dir);
    expect(img.type).toBe('base64');
    expect(img.mediaType).toBe('image/png');
    expect(img.data.length).toBeGreaterThan(10);
  });

  it('rejects unsupported extension', () => {
    const path = join(dir, 'a.bmp');
    writeFileSync(path, 'x');
    expect(() => loadImageFromFile(path, dir)).toThrow(/Unsupported/);
  });

  it('imageFromUrl requires https', () => {
    expect(() => imageFromUrl('http://evil')).toThrow(/https/);
    expect(imageFromUrl('https://example.com/a.png').type).toBe('url');
  });

  it('mediaTypeFromPath maps common types', () => {
    expect(mediaTypeFromPath('x.JPEG')).toBe('image/jpeg');
    expect(mediaTypeFromPath('x.txt')).toBeNull();
  });
});

describe('G4 serializer', () => {
  it('serializes user image blocks with media_type', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          {
            type: 'image',
            image: { type: 'base64', mediaType: 'image/png', data: 'abc' },
          },
        ],
        timestamp: 1,
      },
    ];
    const api = serializeMessagesForApi(messages);
    const content = api[0]?.content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: 'text', text: 'what is this?' });
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc' },
    });
  });

  it('serializeImageSource maps url', () => {
    expect(serializeImageSource({ type: 'url', mediaType: 'image/png', data: 'https://x/a.png' })).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://x/a.png' },
    });
  });
});

describe('G4 attachImagesToLatestUserMessage', () => {
  it('replaces trailing string user message with multimodal blocks', () => {
    const state = {
      sessionId: 's',
      messages: [{ role: 'user' as const, content: 'see this', timestamp: 1 }],
      toolCallHistory: [],
      maxOutputTokensRecoveryCount: 0,
      mode: PermissionMode.DEFAULT,
      hooks: { hooks: {} },
      compactionHistory: [],
    };
    attachImagesToLatestUserMessage(state, 'see this', [
      { type: 'base64', mediaType: 'image/png', data: 'zz' },
    ]);
    const content = state.messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toEqual([
      { type: 'text', text: 'see this' },
      { type: 'image', image: { type: 'base64', mediaType: 'image/png', data: 'zz' } },
    ]);
  });
});
