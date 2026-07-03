/**
 * Claude Code Style Boot Animation
 *
 * Animated startup screen inspired by Claude Code CLI.
 */

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const GRAY = '\x1b[90m';

export class BootAnimation {
  constructor() {}

  async show(): Promise<void> {
    this.clearScreen();
    await this.delay(100);
    this.printLogo();
    await this.delay(200);
    this.printInfo();
    await this.delay(300);
    this.printStatus();
    await this.delay(200);
    this.printReady();
  }

  private clearScreen(): void {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  private printLogo(): void {
    const logo = `
${CYAN}${BOLD}   ╔══════════════════════════════════════════════════════════════╗
   ║                                                              ║
   ║  ${MAGENTA}██████╗${CYAN} █████╗ ${GREEN}██████╗${CYAN}  ██████╗ ${YELLOW}██████╗ ${BLUE}███████╗${CYAN}        ║
   ║  ${MAGENTA}██╔══██╗${CYAN}██╔══██╗${GREEN}██╔══██╗${CYAN}██╔═══██╗${YELLOW}██╔══██╗${BLUE}██╔════╝${CYAN}        ║
   ║  ${MAGENTA}██████╔╝${CYAN}███████║${GREEN}██║  ██║${CYAN}██║   ██║${YELLOW}██║  ██║${BLUE}█████╗  ${CYAN}          ║
   ║  ${MAGENTA}██╔═══╝ ${CYAN}██╔══██║${GREEN}██║  ██║${CYAN}██║   ██║${YELLOW}██║  ██║${BLUE}██╔══╝  ${CYAN}          ║
   ║  ${MAGENTA}██║     ${CYAN}██║  ██║${GREEN}██████╔╝${CYAN}╚██████╔╝${YELLOW}██████╔╝${BLUE}███████╗${CYAN}        ║
   ║  ${CYAN}╚═╝     ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝        ║
   ║                                                              ║
   ╚══════════════════════════════════════════════════════════════╝${RESET}
`;
    console.log(logo);
  }

  private printInfo(): void {
    const info = [
      `${GRAY}┌────────────────────────────────────────────────────────────┐${RESET}`,
      `${GRAY}│${RESET}  ${BOLD}PaCode${RESET} ${DIM}v0.1.0${RESET}                                          ${GRAY}│${RESET}`,
      `${GRAY}│${RESET}  ${DIM}Claude Code-like AI Programming Assistant${RESET}              ${GRAY}│${RESET}`,
      `${GRAY}│${RESET}  ${DIM}Model:${RESET} ${CYAN}claude-sonnet-4-0${RESET}                                  ${GRAY}│${RESET}`,
      `${GRAY}└────────────────────────────────────────────────────────────┘${RESET}`,
    ];
    console.log(info.join('\n'));
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
    const ready = `
${GREEN}${BOLD}  ✓ Ready${RESET} ${DIM}— Type your message to begin${RESET}

${GRAY}  ╭─────────────────────────────────────────────────────────╮${RESET}
${GRAY}  │${RESET}  ${CYAN}Quick commands:${RESET}                                     ${GRAY}│${RESET}
${GRAY}  │${RESET}  ${YELLOW}pacode -m plan${RESET} ${DIM}Planning mode (no execution)${RESET}      ${GRAY}│${RESET}
${GRAY}  │${RESET}  ${YELLOW}pacode -m acceptEdits${RESET} ${DIM}Auto-approve edits${RESET}         ${GRAY}│${RESET}
${GRAY}  │${RESET}  ${YELLOW}pacode --help${RESET} ${DIM}Show all options${RESET}                ${GRAY}│${RESET}
${GRAY}  ╰─────────────────────────────────────────────────────────╯${RESET}

`;
    console.log(ready);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const bootAnimation = new BootAnimation();
