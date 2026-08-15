/**
 * K7 Ink — paste chip 适配层
 *
 * 复用 paste-chips.ts 的纯函数(colorizePasteChips / hasCollapsedTextPaste /
 * expandPastedTextRefs / extractImagesAndStripRefs / parsePasteReferences)。
 * 本文件只做"在 React/Ink 里维护 pasted Map + 渲染时着色"。
 */

import { useCallback, useRef, useState } from 'react';
import {
  colorizePasteChips,
  expandPastedTextRefs,
  extractImagesAndStripRefs,
  hasCollapsedTextPaste,
  parsePasteReferences,
  shouldCollapsePaste,
  type PastedContent,
} from '../paste-chips.js';

export interface UsePasteChipsApi {
  pasted: Map<number, PastedContent>;
  /** 给 buffer 加一段粘贴内容(超长/多行折叠为芯片,否则原样插入)。返回新 buffer。 */
  pasteText: (text: string) => string;
  /** 给 buffer 加一张图片芯片。返回新 buffer。 */
  pasteImage: (img: { mediaType: string; data: string }) => string;
  /** 渲染时着色芯片 */
  colorize: (text: string) => string;
  /** 提交前剥离文本芯片 → 还原正文 */
  expandForSubmit: (text: string) => string;
  /** 提交前剥离图片芯片 → 拿到 images[] + 纯文本 */
  extractImages: (text: string) => { text: string; images: ReturnType<typeof Array<never>> };
  /** 当前 buffer 是否含有未展开的文本芯片(用于输入区下方状态栏) */
  hasCollapsed: (text: string) => boolean;
}

export function usePasteChips(): UsePasteChipsApi {
  const [pastedMap] = useState(() => new Map<number, PastedContent>());
  const nextIdRef = useRef(1);

  const pasteText = useCallback(
    (text: string): string => {
      if (!text) return '';
      if (!shouldCollapsePaste(text)) return text;
      const id = nextIdRef.current++;
      pastedMap.set(id, { id, type: 'text', content: text });
      const numLines = (text.match(/\r\n|\r|\n/g) || []).length;
      const chip = numLines === 0 ? `[Pasted text #${id}]` : `[Pasted text #${id} +${numLines} lines]`;
      return chip;
    },
    [pastedMap]
  );

  const pasteImage = useCallback(
    (img: { mediaType: string; data: string }): string => {
      const id = nextIdRef.current++;
      pastedMap.set(id, { id, type: 'image', content: img.data, mediaType: img.mediaType });
      return `[Image #${id}]`;
    },
    [pastedMap]
  );

  return {
    pasted: pastedMap,
    pasteText,
    pasteImage,
    colorize: (t: string): string => colorizePasteChips(t),
    expandForSubmit: (t: string): string => expandPastedTextRefs(t, pastedMap),
    extractImages: (t: string) => extractImagesAndStripRefs(t, pastedMap) as unknown as {
      text: string;
      images: ReturnType<typeof Array<never>>;
    },
    hasCollapsed: (t: string): boolean => hasCollapsedTextPaste(t, pastedMap),
  };
}

/**
 * 给定 buffer,返回 (colorized, hasCollapsed) — 单帧渲染时取一次即可。
 */
export function renderPasteBuffer(
  buffer: string,
  pasted: Map<number, PastedContent>
): { colorized: string; collapsed: boolean } {
  return {
    colorized: colorizePasteChips(buffer),
    collapsed: hasCollapsedTextPaste(buffer, pasted),
  };
}

/** 统计 buffer 里芯片 ref 数量 — 调试/测试用 */
export function countPasteRefs(buffer: string): number {
  return parsePasteReferences(buffer).length;
}