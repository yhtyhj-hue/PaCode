/**
 * Streaming markdown writer — incremental inline formatting for live output
 *
 * 表格行会缓冲到整块表格结束后再按 CJK 可见宽度排版，避免 | 列对不齐。
 */

import { EnhancedRenderer } from './enhanced-renderer.js';
import { isTableRow, rewriteTablesInText } from './markdown-table.js';

export class StreamingMarkdownWriter {
  private buffer = '';
  private printedLength = 0;
  private renderer: EnhancedRenderer;
  /** 正在累积的表格完整行 */
  private tableBuf: string[] = [];

  constructor(renderer?: EnhancedRenderer) {
    this.renderer = renderer ?? new EnhancedRenderer();
  }

  /** 追加 delta，返回可立即输出的格式化片段 */
  append(delta: string): string {
    this.buffer += delta;
    const safePrefix = this.getSafePrefix();
    const newText = safePrefix.slice(this.printedLength);
    this.printedLength = safePrefix.length;
    if (!newText) return '';
    return this.emitFormatted(newText);
  }

  /** 流结束时输出剩余缓冲 */
  flush(): string {
    const remaining = this.buffer.slice(this.printedLength);
    this.printedLength = this.buffer.length;
    let out = '';
    if (remaining) out += this.emitFormatted(remaining);
    if (this.tableBuf.length > 0) out += this.flushTableBuf();
    return out;
  }

  reset(): void {
    this.buffer = '';
    this.printedLength = 0;
    this.tableBuf = [];
  }

  /**
   * 按完整行处理：表格块攒齐后 rewrite；非表格立刻 markdown 渲染。
   */
  private emitFormatted(chunk: string): string {
    const parts: string[] = [];
    const hasTrailingNl = chunk.endsWith('\n');
    const lines = chunk.split('\n');
    // 有尾部 \n 时末项为空串，属于「完成的空行」；无尾部 \n 时末项是未完成行
    const completeLines = hasTrailingNl ? lines.slice(0, -1) : lines.slice(0, -1);
    const incompleteTail = hasTrailingNl ? '' : (lines[lines.length - 1] ?? '');

    for (const line of completeLines) {
      if (isTableRow(line)) {
        this.tableBuf.push(line);
        continue;
      }
      if (this.tableBuf.length > 0) {
        parts.push(this.flushTableBuf());
      }
      parts.push(this.renderer.renderMarkdown(`${line}\n`));
    }

    // 未完成行：表行等待下一 chunk；普通文本即时透出
    if (incompleteTail && !isTableRow(incompleteTail) && this.tableBuf.length === 0) {
      parts.push(this.renderer.renderMarkdown(incompleteTail));
    }

    return parts.join('');
  }

  private flushTableBuf(): string {
    if (this.tableBuf.length === 0) return '';
    const raw = `${this.tableBuf.join('\n')}\n`;
    this.tableBuf = [];
    // 表格已含 ANSI，不再过 renderMarkdown（避免 _italic_ 等规则破坏路径/布局）
    return rewriteTablesInText(raw) + '\n';
  }

  private getSafePrefix(): string {
    let text = this.buffer;

    // 未闭合的反引号
    const tickCount = (text.match(/`/g) ?? []).length;
    if (tickCount % 2 === 1) {
      const lastTick = text.lastIndexOf('`');
      text = text.slice(0, lastTick);
    }

    // 未闭合的 **bold**
    const boldMarkers = (text.match(/\*\*/g) ?? []).length;
    if (boldMarkers % 2 === 1) {
      const lastOpen = text.lastIndexOf('**');
      text = text.slice(0, lastOpen);
    }

    // 未结束的表格行：等换行后再排版（含 Unicode 框线）
    const lastNl = text.lastIndexOf('\n');
    const incomplete = lastNl >= 0 ? text.slice(lastNl + 1) : text;
    const trimmed = incomplete.trimStart();
    if (
      trimmed.startsWith('|') ||
      trimmed.startsWith('│') ||
      trimmed.startsWith('┌') ||
      trimmed.startsWith('├') ||
      trimmed.startsWith('└')
    ) {
      text = lastNl >= 0 ? text.slice(0, lastNl + 1) : '';
    }

    return text;
  }
}

/** 工具调用摘要，供权限提示和 UI 展示 */
export function summarizeToolAction(tool: {
  name: string;
  input: Record<string, unknown>;
}): string {
  const input = tool.input;
  switch (tool.name) {
    case 'Bash':
      return String(input['command'] ?? '');
    case 'Read':
    case 'Write':
    case 'Edit':
      return String(input['path'] ?? tool.name);
    case 'Glob':
    case 'Grep':
      return String(input['pattern'] ?? tool.name);
    case 'Task':
      return String(input['description'] ?? input['prompt'] ?? '').slice(0, 80);
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}
