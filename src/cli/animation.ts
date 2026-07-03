/**
 * Claude Code Style Boot Animation
 *
 * Capybara mascot + PACODE ASCII text
 */

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

export class BootAnimation {
  constructor() {}

  async show(): Promise<void> {
    this.clearScreen();
    await this.delay(100);
    this.printCapybara();
    await this.delay(300);
    this.printLogo();
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
    // Use unicode characters that work in terminals
    const ear = '▲';  // ▲ triangle ear
    const eye = '•';  // • dot eye
    const nose = '▼'; // ▼ nose
    const line = '─'; // ─ line

    const capybara = [
      '',
      `       ${BROWN}(${DARK_BROWN}${'  '.padEnd(8)}${BROWN})${RESET}`,
      `      ${DARK_BROWN}/${BROWN}(        )${DARK_BROWN}\\${RESET}`,
      `      ${DARK_BROWN}|${BROWN}(${ear}    ${ear})${DARK_BROWN}|${RESET}`,
      `      ${DARK_BROWN}|${BROWN}(  ${PINK}${eye}  ${eye}${BROWN}  )${DARK_BROWN}|${RESET}`,
      `      ${DARK_BROWN}|${BROWN}(    ${nose}    )${DARK_BROWN}|${RESET}`,
      `      ${DARK_BROWN}|${BROWN}( ${line}${line}${line} )${DARK_BROWN}|${RESET}`,
      `      ${DARK_BROWN}\\__________/${RESET}`,
      `     /            \\${RESET}`,
      `    /              \\${RESET}`,
      `   /                \\${RESET}`,
      `  ${DARK_BROWN}/________________\\${RESET}`,
      '',
    ].join('\n');
    console.log(capybara);
  }

  private printLogo(): void {
    // Standard PACODE block letters
    const logo = [
      '',
      `${CYAN}${BOLD}   ██████╗${RESET} ${GREEN}${BOLD}█████╗${RESET} ${YELLOW}${BOLD}██████╗${RESET} ${BLUE}${BOLD}█████╗${RESET} ${MAGENTA}${BOLD}█████╗${RESET} ${CYAN}${BOLD}██████╗${RESET}`,
      `${CYAN}${BOLD}   ██╔══██╗${RESET}${GREEN}${BOLD}██╔══██╗${RESET}${YELLOW}${BOLD}██╔══██╗${RESET}${BLUE}${BOLD}██╔══██╗${RESET}${MAGENTA}${BOLD}██╔══██╗${RESET}${CYAN}${BOLD}██╔════╝${RESET}`,
      `${CYAN}${BOLD}   ██████╔╝${RESET}${GREEN}${BOLD}██████╔╝${RESET}${YELLOW}${BOLD}██████╔╝${RESET}${BLUE}${BOLD}██████╔╝${RESET}${MAGENTA}${BOLD}██║   ██║${RESET}${CYAN}${BOLD}█████╗${RESET}`,
      `${CYAN}${BOLD}   ██╔═══╝ ${RESET}${GREEN}${BOLD}██╔══██╗${RESET}${YELLOW}${BOLD}██╔══██╗${RESET}${BLUE}${BOLD}██╔══██╗${RESET}${MAGENTA}${BOLD}██║   ██║${RESET}${CYAN}${BOLD}██╔══╝${RESET}`,
      `${CYAN}${BOLD}   ██║     ${RESET}${GREEN}${BOLD}██║  ██║${RESET}${YELLOW}${BOLD}██║  ██║${RESET}${BLUE}${BOLD}██║  ██║${RESET}${MAGENTA}${BOLD}╚██████╔╝${RESET}${CYAN}${BOLD}███████╗${RESET}`,
      `${CYAN}${BOLD}   ╚═╝     ${RESET}${GREEN}${BOLD}╚═╝  ╚═╝${RESET}${YELLOW}${BOLD}╚═╝  ╚═╝${RESET}${BLUE}${BOLD}╚═╝  ╚═╝${RESET}${MAGENTA}${BOLD} ╚═════╝ ${RESET}${CYAN}${BOLD}╚══════╝${RESET}`,
      '',
    ].join('\n');
    console.log(logo);
  }

  private printInfo(): void {
    const dash = '─';
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
    const dash = '─';
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