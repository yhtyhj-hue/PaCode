/**
 * Claude Code Style Boot Animation
 *
 * Capybara mascot (round body + small ears + closed eyes)
 */

import figlet from 'figlet';

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
const BROWN = '\x1b[38;5;130m';
const DARK_BROWN = '\x1b[38;5;94m';
const PINK = '\x1b[38;5;218m';
const RED = '\x1b[31m';

export class BootAnimation {
  constructor() {}

  async show(): Promise<void> {
    this.clearScreen();
    await this.delay(100);
    this.printCapybara();
    await this.delay(400);
    await this.printLogo();
    await this.delay(300);
    this.printInfo();
    await this.delay(200);
    this.printStatus();
    await this.delay(200);
    this.printReady();
  }

  private clearScreen(): void {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  private printCapybara(): void {
    // Round chubby capybara matching the reference image style
    // - Round body (chunky oval shape)
    // - Small round ears on top
    // - Closed eyes (squint lines)
    // - Visible nose (dark brown)
    // - Small front paws
    const lines = [
      '',
      `         ${DARK_BROWN}o   o${RESET}`,
      `        ${DARK_BROWN}o${BROWN}____${DARK_BROWN}o${RESET}`,
      `       ${BROWN}/${PINK}..${BROWN}____${PINK}..${BROWN}\\${RESET}`,
      `      ${BROWN}|${RED}  ${DARK_BROWN}o${RED}      ${DARK_BROWN}o${RED}  ${BROWN}|${RESET}  <- closed eyes`,
      `      ${BROWN}|${RED}   ${RED}\\___/${RED}   ${BROWN}|${RESET}`,
      `       ${BROWN}\\____________/${RESET}`,
      `      ${BROWN} .${BROWN}________${BROWN}.${RESET}`,
      `     ${BROWN} .${DARK_BROWN}o${BROWN}        ${DARK_BROWN}o${BROWN}.${RESET}`,
      `    ${BROWN}.${DARK_BROWN}o${BROWN}            ${DARK_BROWN}o${BROWN}.${RESET}`,
      `   ${BROWN}.${DARK_BROWN}o${BROWN}              ${DARK_BROWN}o${BROWN}.${RESET}`,
      `    ${BROWN}\\                /${RESET}`,
      `     ${BROWN}\\              /${RESET}`,
      `      ${BROWN}\\____________/${RESET}`,
      `       ${DARK_BROWN}o        o${RESET}    <- feet`,
      `       ${DARK_BROWN}o        o${RESET}`,
      '',
    ];
    console.log(lines.join('\n'));
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

  private printInfo(): void {
    const dash = '-';
    const info = [
      '',
      `+${dash.repeat(60)}+`,
      `|  ${BOLD}PaCode${RESET} ${DIM}v0.1.0${RESET}                                          |`,
      `|  ${DIM}Claude Code-like AI Programming Assistant${RESET}              |`,
      `|  ${DIM}Model:${RESET} ${CYAN}claude-sonnet-4-0${RESET}                                  |`,
      `+${dash.repeat(60)}+`,
      '',
    ].join('\n');
    console.log(info);
  }

  private printStatus(): void {
    const checks = [
      { label: 'Session Manager', status: 'OK', color: GREEN },
      { label: 'Tool Registry', status: 'OK', color: GREEN },
      { label: 'Permission System', status: 'OK', color: GREEN },
      { label: 'Context Engine', status: 'OK', color: GREEN },
      { label: 'Compaction Pipeline', status: 'OK', color: GREEN },
    ];

    console.log(`\n${DIM}Initializing components...${RESET}`);

    for (const check of checks) {
      const dot = `${check.color}●${RESET}`;
      const line = `  ${dot} ${check.label.padEnd(28)} ${DIM}[${RESET}${check.color}${check.status}${RESET}${DIM}]${RESET}`;
      console.log(line);
    }
  }

  private printReady(): void {
    const dash = '-';
    const ready = [
      '',
      `${GREEN}${BOLD}  ✓ Ready${RESET} ${DIM}— Type your message to begin${RESET}`,
      '',
      `  +${dash.repeat(60)}+`,
      `  |  ${CYAN}Quick commands:${RESET}                                     |`,
      `  |  ${YELLOW}pacode -m plan${RESET} ${DIM}Planning mode (no execution)${RESET}      |`,
      `  |  ${YELLOW}pacode -m acceptEdits${RESET} ${DIM}Auto-approve edits${RESET}         |`,
      `  |  ${YELLOW}pacode --help${RESET} ${DIM}Show all options${RESET}                |`,
      `  +${dash.repeat(60)}+`,
      '',
    ].join('\n');
    console.log(ready);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const bootAnimation = new BootAnimation();