/**
 * Markdown 表格终端排版
 *
 * 不用 | / ┌┐ 管线表（CJK + ANSI 极易错位）。
 * 一律转成 Claude Code 风格列表，并按终端可见宽度折行。
 */

import { getUiWidth, visibleWidth } from './repl-ui.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const WHITE = '\x1b[97m';

/** 单行是否属于表格块（markdown | 或 Unicode 框线） */
export function isTableRow(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  // markdown pipe table
  if (t.startsWith('|') && t.includes('|', 1)) return true;
  // Unicode 框线：边框行或数据行
  if (isBoxBorderRow(t)) return true;
  return /^[│├].*[│┤]/.test(t);
}

/** 是否为 Unicode 框线表的边框/分隔行（无单元格文本） */
export function isBoxBorderRow(line: string): boolean {
  const t = line.trim();
  return /^[┌┬┐├┼┤└┴┘─═\s\-]+$/.test(t);
}

/** 是否为 |---|---| 或 ├──┼──┤ 分隔行（无数据，应丢弃） */
export function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (isBoxBorderRow(t)) return true;
  if (!t.startsWith('|')) return false;
  return /^\|[\s|:\-]+\|$/.test(t) || /^[\s|:\-]+$/.test(t.slice(1, -1) || t);
}

/** 拆分单元格：兼容 markdown | 与 Unicode │ */
export function splitTableCells(line: string): string[] {
  let t = line.trim();
  t = t.replace(/[│┃]/g, '|');
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

/** 长文本按可见宽度折行 */
export function wrapVisible(text: string, maxWidth: number): string[] {
  const max = Math.max(4, maxWidth);
  if (visibleWidth(text) <= max) return [text];

  const lines: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (visibleWidth(rest) <= max) {
      lines.push(rest);
      break;
    }
    let acc = '';
    let cut = 0;
    for (const ch of rest) {
      if (visibleWidth(acc + ch) > max) break;
      acc += ch;
      cut += ch.length;
    }
    if (cut === 0) {
      const first = [...rest][0] ?? '?';
      acc = first;
      cut = first.length;
    }
    lines.push(acc);
    rest = rest.slice(cut).trimStart();
  }
  return lines;
}

/**
 * 任意列表格 → CC 风格卡片列表（自适应终端宽度）
 *
 * ● 真实代码改动
 *   ├ 代表文件: src/agent/engine.ts …
 *   └ 评估: aef8679 安全加固 …
 */
export function formatTableAsCards(
  rows: string[][],
  options: { width?: number } = {}
): string {
  if (rows.length === 0) return '';
  const width = options.width ?? getUiWidth();
  const headers = rows[0] ?? [];
  const body = rows.slice(1);
  if (body.length === 0) return '';

  return body
    .map((row) => {
      const title = row[0] ?? '';
      const out: string[] = [`${WHITE}●${RESET} ${BOLD}${title}${RESET}`];

      const fields = row.slice(1);
      fields.forEach((cell, i) => {
        const header = headers[i + 1] ?? `列${i + 2}`;
        const branch = i === fields.length - 1 ? '└' : '├';
        const prefix = `  ${DIM}${branch}${RESET} ${DIM}${header}:${RESET} `;
        const prefixPlain = `  ${branch} ${header}: `;
        const valueWidth = Math.max(12, width - visibleWidth(prefixPlain));
        const wrapped = wrapVisible(cell, valueWidth);
        const contPad = ' '.repeat(visibleWidth(prefixPlain));

        out.push(`${prefix}${wrapped[0] ?? ''}`);
        for (let j = 1; j < wrapped.length; j++) {
          out.push(`${contPad}${wrapped[j]}`);
        }
      });

      return out.join('\n');
    })
    .join('\n\n');
}

/** 两列兼容入口 */
export function formatTwoColumnTable(rows: string[][]): string {
  return formatTableAsCards(rows);
}

/** 多列兼容入口（不再画框线表） */
export function formatAlignedTable(rows: string[][]): string {
  return formatTableAsCards(rows);
}

export function formatTableRows(cellRows: string[][], width = getUiWidth()): string {
  if (cellRows.length === 0) return '';
  return formatTableAsCards(cellRows, { width });
}

/** 扫描文本中的完整表格块并替换 */
export function rewriteTablesInText(text: string, width = getUiWidth()): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!isTableRow(line)) {
      out.push(line);
      i++;
      continue;
    }

    const tableLines: string[] = [];
    while (i < lines.length && isTableRow(lines[i]!)) {
      tableLines.push(lines[i]!);
      i++;
    }

    const cells = tableLines
      .filter((l) => !isTableSeparator(l))
      .map(splitTableCells);

    if (cells.length === 0) {
      out.push(...tableLines);
      continue;
    }

    out.push(formatTableRows(cells, width));
  }

  return out.join('\n');
}
