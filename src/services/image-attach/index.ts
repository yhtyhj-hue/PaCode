/**
 * G4: 从本地文件或 data URL 加载图片 → ImageSource（供 QueryRequest.images）
 */

import { readFileSync, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import type { ImageSource } from '../../pkg/types.js';

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const MAX_BYTES = 5 * 1024 * 1024;

export function mediaTypeFromPath(path: string): string | null {
  return EXT_MIME[extname(path).toLowerCase()] ?? null;
}

/** 读取工作区内图片文件为 base64 ImageSource */
export function loadImageFromFile(
  path: string,
  workingDirectory: string = process.cwd()
): ImageSource {
  const abs = resolve(workingDirectory, path);
  if (!existsSync(abs)) {
    throw new Error(`Image not found: ${path}`);
  }
  const mediaType = mediaTypeFromPath(abs);
  if (!mediaType) {
    throw new Error(`Unsupported image type (use png/jpeg/gif/webp): ${path}`);
  }
  const buf = readFileSync(abs);
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`Image exceeds ${MAX_BYTES} bytes: ${path}`);
  }
  return {
    type: 'base64',
    mediaType,
    data: buf.toString('base64'),
  };
}

/** 解析 https URL 为 url ImageSource（不下载；由 API 拉取） */
export function imageFromUrl(url: string, mediaType = 'image/png'): ImageSource {
  if (!/^https:\/\//i.test(url)) {
    throw new Error('Image URL must be https://');
  }
  return { type: 'url', mediaType, data: url };
}
