/**
 * Logger - Structured logging utility
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_NAMES = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  timestamp?: boolean;
}

export class Logger {
  private level: LogLevel;
  private prefix: string;
  private timestamp: boolean;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevel.WARN;
    this.prefix = options.prefix ?? '';
    this.timestamp = options.timestamp ?? true;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private format(level: LogLevel, msg: string, ...args: unknown[]): string {
    const parts: string[] = [];
    if (this.timestamp) parts.push(new Date().toISOString());
    parts.push(`[${LEVEL_NAMES[level]}]`);
    if (this.prefix) parts.push(`[${this.prefix}]`);
    parts.push(msg);
    if (args.length > 0) {
      parts.push(
        ...args.map((a) =>
          a instanceof Error
            ? `${a.message}\n${a.stack}`
            : typeof a === 'object'
              ? JSON.stringify(a)
              : String(a)
        )
      );
    }
    return parts.join(' ');
  }

  debug(msg: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) console.debug(this.format(LogLevel.DEBUG, msg, ...args));
  }

  info(msg: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) console.info(this.format(LogLevel.INFO, msg, ...args));
  }

  warn(msg: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) console.warn(this.format(LogLevel.WARN, msg, ...args));
  }

  error(msg: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) console.error(this.format(LogLevel.ERROR, msg, ...args));
  }

  child(prefix: string): Logger {
    return new Logger({
      level: this.level,
      prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
      timestamp: this.timestamp,
    });
  }
}

export const logger = new Logger({ level: LogLevel.WARN });
export function createLogger(prefix: string, level?: LogLevel): Logger {
  return new Logger({ prefix, level });
}
