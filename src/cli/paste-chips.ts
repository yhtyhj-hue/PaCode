/**
 * CC 风格粘贴芯片 — 占位显示，提交时展开
 *
 * 文本: [Pasted text #N] / [Pasted text #N +M lines]（M = 换行数）
 * 图片: [Image #N]
 */

import type { ImageSource } from '../pkg/types.js';

export const PASTE_THRESHOLD = 800;

export type PastedContent =
  | { id: number; type: 'text'; content: string }
  | { id: number; type: 'image'; content: string; mediaType: string };

export function getPastedTextRefNumLines(text: string): number {
  return (text.match(/\r\n|\r|\n/g) || []).length;
}

export function formatPastedTextRef(id: number, numLines: number): string {
  if (numLines === 0) return `[Pasted text #${id}]`;
  return `[Pasted text #${id} +${numLines} lines]`;
}

export function formatImageRef(id: number): string {
  return `[Image #${id}]`;
}

function refPattern(): RegExp {
  return /\[(Pasted text|Image|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?(?:\.\.\.)?\]/g;
}

export function parsePasteReferences(
  input: string
): Array<{ id: number; match: string; index: number; kind: 'text' | 'image' }> {
  const out: Array<{ id: number; match: string; index: number; kind: 'text' | 'image' }> =
    [];
  for (const m of input.matchAll(refPattern())) {
    const id = Number.parseInt(m[2] ?? '0', 10);
    if (id <= 0 || m.index === undefined) continue;
    const kind = m[1] === 'Image' ? 'image' : 'text';
    out.push({ id, match: m[0], index: m.index, kind });
  }
  return out;
}

/** 是否应折叠为芯片（多行或超长） */
export function shouldCollapsePaste(text: string): boolean {
  if (!text) return false;
  if (text.includes('\n') || text.includes('\r')) return true;
  return text.length >= PASTE_THRESHOLD;
}

/** 提交前：文本芯片换回正文；图片芯片保留给上层剥离 */
export function expandPastedTextRefs(
  input: string,
  pasted: Map<number, PastedContent> | Record<number, PastedContent>
): string {
  const store =
    pasted instanceof Map
      ? pasted
      : new Map(Object.entries(pasted).map(([k, v]) => [Number(k), v]));
  const refs = parsePasteReferences(input);
  let expanded = input;
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i]!;
    const content = store.get(ref.id);
    if (!content || content.type !== 'text') continue;
    expanded =
      expanded.slice(0, ref.index) +
      content.content +
      expanded.slice(ref.index + ref.match.length);
  }
  return expanded;
}

/** 从输入中收集图片芯片对应的 ImageSource，并去掉芯片 token */
export function extractImagesAndStripRefs(
  input: string,
  pasted: Map<number, PastedContent>
): { text: string; images: ImageSource[] } {
  const refs = parsePasteReferences(input);
  const images: ImageSource[] = [];
  let text = input;
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i]!;
    const content = pasted.get(ref.id);
    if (ref.kind === 'image' && content?.type === 'image') {
      images.unshift({
        type: 'base64',
        mediaType: content.mediaType,
        data: content.content,
      });
      text = text.slice(0, ref.index) + text.slice(ref.index + ref.match.length);
    }
  }
  // 清理芯片旁多余空格
  text = text.replace(/[ \t]{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
  return { text, images };
}

const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

/** 渲染用：芯片标绿 */
export function colorizePasteChips(input: string): string {
  return input.replace(refPattern(), (m) => `${GREEN}${m}${RESET}`);
}

export function hasCollapsedTextPaste(
  input: string,
  pasted: Map<number, PastedContent>
): boolean {
  for (const ref of parsePasteReferences(input)) {
    if (ref.kind !== 'text') continue;
    const c = pasted.get(ref.id);
    if (c?.type === 'text') return true;
  }
  return false;
}

/** 把文本芯片展开进 buffer（编辑用） */
export function expandChipsInBuffer(
  input: string,
  pasted: Map<number, PastedContent>
): string {
  return expandPastedTextRefs(input, pasted);
}
