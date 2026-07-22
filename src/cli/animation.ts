/**
 * Claude Code Style Boot Animation
 *
 * Figlet PACODE logo + 真实启动自检（非写死 OK）
 */

import figlet from 'figlet';
import { formatBox, getUiWidth, visibleWidth } from './repl-ui.js';
import { getPackageVersion } from '../pkg/version.js';
import { formatSetupGuide } from './setup-guide.js';

const figletAsync = (text: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    figlet.text(text, (err, result) => {
      if (err) reject(err);
      else resolve(result ?? '');
    });
  });
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[31m';

export interface BootStatusInput {
  model?: string;
  apiKeyConfigured?: boolean;
  providerCount?: number;
  activeProvider?: string;
}

export interface BootCheck {
  label: string;
  ok: boolean;
  detail: string;
}

/** 基于真实配置生成启动检查项（禁止写死全部 OK） */
export function buildBootChecks(input: BootStatusInput): BootCheck[] {
  const providerCount = input.providerCount ?? 0;
  const hasKey = Boolean(input.apiKeyConfigured);
  const model = input.model?.trim() || '';

  return [
    {
      label: 'API credentials',
      ok: hasKey,
      detail: hasKey ? 'configured' : 'missing — see setup below',
    },
    {
      label: 'Provider registry',
      ok: providerCount > 0 || hasKey,
      detail:
        providerCount > 0
          ? `${providerCount} provider${providerCount === 1 ? '' : 's'}${
              input.activeProvider ? ` · active ${input.activeProvider}` : ''
            }`
          : hasKey
            ? 'using env key (no saved provider)'
            : 'none — set env key or cc-switch',
    },
    {
      label: 'Model',
      ok: model.length > 0,
      detail: model || 'unset',
    },
  ];
}

export class BootAnimation {
  async show(input: string | BootStatusInput = {}): Promise<void> {
    const status: BootStatusInput =
      typeof input === 'string' ? { model: input } : input;

    this.clearScreen();
    await this.delay(100);
    await this.printLogo();
    await this.delay(300);
    this.printInfo(status.model);
    await this.delay(200);
    this.printStatus(status);
    await this.delay(200);
    // 缺 Key 时不谎称 Ready，直接给分步配置（与 -p 路径共用文案）
    if (status.apiKeyConfigured) {
      this.printReady();
    } else {
      this.printSetupRequired();
    }
  }

  private clearScreen(): void {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  private async printLogo(): Promise<void> {
    try {
      const logo = await figletAsync('PACODE');
      const colors = [CYAN, GREEN, YELLOW, BLUE, MAGENTA];
      const logoLines = logo.split('\n');
      const coloredLines = logoLines.map((line, idx) => {
        const color = colors[idx % colors.length] ?? CYAN;
        return `${BOLD}${color}${line}${RESET}`;
      });
      console.log(coloredLines.join('\n'));
    } catch {
      console.log(`${CYAN}${BOLD}PACODE${RESET}`);
    }
  }

  private printInfo(model?: string): void {
    const displayModel = model || '(unset)';
    const width = getUiWidth();
    console.log('');
    console.log(
      formatBox(
        [
          `${BOLD}PaCode${RESET} ${DIM}v${getPackageVersion()}${RESET}`,
          `${DIM}Claude Code-like AI Programming Assistant${RESET}`,
          `${DIM}Model:${RESET} ${CYAN}${displayModel}${RESET}`,
        ],
        { width }
      )
    );
    console.log('');
  }

  private printStatus(input: BootStatusInput): void {
    const checks = buildBootChecks(input);

    console.log(`\n${DIM}Startup checks...${RESET}`);

    const labelWidth = Math.max(...checks.map((c) => visibleWidth(c.label)));
    for (const check of checks) {
      const pad = ' '.repeat(Math.max(0, labelWidth - visibleWidth(check.label)));
      const color = check.ok ? GREEN : RED;
      const status = check.ok ? 'OK' : 'FAIL';
      console.log(
        `  ${color}●${RESET} ${check.label}${pad}  ${DIM}[${RESET}${color}${status}${RESET}${DIM}]${RESET} ${DIM}${check.detail}${RESET}`
      );
    }
  }

  private printReady(): void {
    const width = getUiWidth();
    console.log('');
    console.log(`${GREEN}${BOLD}✓ Ready${RESET} ${DIM}— Type your message to begin${RESET}`);
    console.log('');
    console.log(
      formatBox(
        [
          `${CYAN}Quick commands:${RESET}`,
          `${YELLOW}/help${RESET} ${DIM}REPL slash commands (inside chat)${RESET}`,
          `${YELLOW}/mode plan${RESET} ${DIM}Planning mode (no tool execution)${RESET}`,
          `${YELLOW}Ctrl+D${RESET} ${DIM}Exit interactive mode${RESET}`,
        ],
        { width }
      )
    );
    console.log('');
  }

  private printSetupRequired(): void {
    console.log('');
    console.log(
      `${YELLOW}${BOLD}✗ Not ready${RESET} ${DIM}— API Key 未配置，请先完成下面步骤${RESET}`
    );
    console.log(formatSetupGuide());
    console.log('');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const bootAnimation = new BootAnimation();
