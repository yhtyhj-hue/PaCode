/**
 * PaCode Boot — figlet 青绿 logo + 圆角信息框 + 真实启动自检
 */

import figlet from 'figlet';
import {
  formatBox,
  getUiWidth,
  visibleWidth,
  BOLD,
  DIM,
  RESET,
  TEAL,
  GREEN,
  YELLOW,
  RED,
  CYAN,
} from './repl-ui.js';
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

export interface BootShowOptions extends BootStatusInput {
  /** TUI 模式:Ink 自己会 enter alt-screen,跳过这里的 clearScreen 避免双重清屏 */
  skipClearScreen?: boolean;
}

export class BootAnimation {
  async show(input: string | BootStatusInput | BootShowOptions = {}): Promise<void> {
    const opts: BootShowOptions =
      typeof input === 'string' ? { model: input } : input;
    const status: BootStatusInput = opts;
    const skipClear = opts.skipClearScreen === true;

    if (!skipClear) this.clearScreen();
    await this.delay(60);
    await this.printLogo();
    await this.delay(120);
    this.printInfo(status.model);
    await this.delay(80);
    this.printStatus(status);
    await this.delay(80);
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
      // 单色青绿，贴近合成预览（不再彩虹条）
      const logo = await figletAsync('PACODE');
      const lines = logo
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((line) => `${BOLD}${TEAL}${line}${RESET}`);
      console.log(lines.join('\n'));
    } catch {
      console.log(`${BOLD}${TEAL}PACODE${RESET}`);
    }
  }

  private printInfo(model?: string): void {
    const displayModel = model || '(unset)';
    const width = Math.min(72, getUiWidth());
    console.log('');
    console.log(
      formatBox(
        [
          `${BOLD}PaCode${RESET} ${DIM}v${getPackageVersion()}${RESET}`,
          `${DIM}Claude Code-like AI Programming Assistant${RESET}`,
          `${DIM}Model:${RESET} ${CYAN}${BOLD}${displayModel}${RESET}`,
        ],
        { width, borderColor: DIM, padding: 2 }
      )
    );
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
        `  ${color}●${RESET} ${check.label}${pad}  ${DIM}[${RESET}${color}${BOLD}${status}${RESET}${DIM}]${RESET} ${DIM}${check.detail}${RESET}`
      );
    }
  }

  private printReady(): void {
    const width = Math.min(72, getUiWidth());
    console.log('');
    console.log(
      `${GREEN}${BOLD}✓ Ready${RESET} ${DIM}— Type your message to begin${RESET}`
    );
    console.log('');
    console.log(
      formatBox(
        [
          `${TEAL}${BOLD}Quick commands:${RESET}`,
          `${YELLOW}/help${RESET}         ${DIM}REPL slash commands${RESET}`,
          `${YELLOW}/mode plan${RESET}    ${DIM}Planning mode (no tools)${RESET}`,
          `${YELLOW}/providers${RESET}    ${DIM}DeepSeek · 豆包 · GLM · OpenAI…${RESET}`,
          `${YELLOW}Ctrl+D${RESET}        ${DIM}Exit interactive mode${RESET}`,
        ],
        { width, borderColor: DIM, padding: 2 }
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
