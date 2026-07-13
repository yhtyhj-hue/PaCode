/**
 * Streaming markdown writer — incremental inline formatting for live output
 */

import { EnhancedRenderer } from './enhanced-renderer.js';

export class StreamingMarkdownWriter {
  private buffer = '';
  private printedLength = 0;
  private renderer: EnhancedRenderer;

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
    return this.renderer.renderMarkdown(newText);
  }

  /** 流结束时输出剩余缓冲 */
  flush(): string {
    const remaining = this.buffer.slice(this.printedLength);
    this.printedLength = this.buffer.length;
    if (!remaining) return '';
    return this.renderer.renderMarkdown(remaining);
  }

  reset(): void {
    this.buffer = '';
    this.printedLength = 0;
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
