/**
 * Enhanced Renderer
 *
 * Provides streaming output, syntax highlighting, and visual polish
 * similar to Claude Code CLI.
 */

import { ToolCall, ToolResult } from '../pkg/types.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';

export class EnhancedRenderer {
  renderToolUse(tool: ToolCall): void {
    const argsStr = Object.entries(tool.input)
      .map(([k, v]) => {
        const value = typeof v === 'string' ? v : JSON.stringify(v);
        const truncated = value.length > 50 ? value.slice(0, 47) + '...' : value;
        return `${k}=${truncated}`;
      })
      .join(' ');
    console.log(`\n${YELLOW}⚡${RESET} ${BOLD}${tool.name}${RESET} ${DIM}${argsStr}${RESET}`);
  }

  renderToolResult(result: ToolResult): void {
    if (result.isError) {
      const text = result.content[0]?.type === 'text' ? result.content[0].text : 'Error';
      console.log(`${RED}✗${RESET} ${text}`);
    } else {
      const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
      const preview = text.length > 100 ? text.slice(0, 97) + '...' : text;
      console.log(`${GREEN}✓${RESET} ${preview}`);
    }
  }

  renderCodeBlock(language: string, code: string): void {
    const lines = code.split('\n');
    console.log(`${GRAY}┌─ ${language} ─${RESET}`);
    for (const line of lines) {
      console.log(`${GRAY}│${RESET} ${line}`);
    }
    console.log(`${GRAY}└${'─'.repeat(40)}${RESET}`);
  }

  async renderPermissionPrompt(toolName: string, action: string): Promise<boolean> {
    return new Promise((resolve) => {
      console.log('');
      console.log(`${YELLOW}?${RESET} ${BOLD}Permission Request${RESET}`);
      console.log(`  ${DIM}Tool:${RESET}   ${toolName}`);
      console.log(`  ${DIM}Action:${RESET} ${action}`);
      console.log('');
      process.stdout.write(`${YELLOW}Allow?${RESET} [${BOLD}y${RESET}]es/${BOLD}n${RESET}]o: `);

      const onData = (data: Buffer) => {
        const answer = data.toString().trim().toLowerCase();
        if (answer === 'y' || answer === '') {
          console.log(`${GREEN}✓${RESET} Allowed`);
          process.stdin.off('data', onData);
          resolve(true);
        } else {
          console.log(`${RED}✗${RESET} Denied`);
          process.stdin.off('data', onData);
          resolve(false);
        }
      };

      process.stdin.once('data', onData);
    });
  }

  header(title: string): void {
    console.log('');
    console.log(`${CYAN}${BOLD}${title}${RESET}`);
    console.log(`${CYAN}${'─'.repeat(title.length)}${RESET}`);
  }

  success(msg: string): void {
    console.log(`${GREEN}✓${RESET} ${msg}`);
  }

  error(msg: string): void {
    console.log(`${RED}✗${RESET} ${msg}`);
  }

  warn(msg: string): void {
    console.log(`${YELLOW}⚠${RESET} ${msg}`);
  }

  info(msg: string): void {
    console.log(`${BLUE}ℹ${RESET} ${msg}`);
  }

  dim(msg: string): void {
    console.log(`${DIM}${msg}${RESET}`);
  }

  renderMarkdown(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`)
      .replace(/\*(.+?)\*/g, `${ITALIC}$1${RESET}`)
      .replace(/_(.+?)_/g, `${ITALIC}$1${RESET}`)
      .replace(/`(.+?)`/g, `${CYAN}$1${RESET}`)
      .replace(/^#{1,6}\s+(.+)$/gm, `${CYAN}${BOLD}$1${RESET}`);
  }
}

export const renderer = new EnhancedRenderer();
