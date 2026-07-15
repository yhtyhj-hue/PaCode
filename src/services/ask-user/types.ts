/**
 * AskUserQuestion Service Types
 *
 * Models an interactive REPL question. Mirrors the shape of Claude Code's
 * AskUserQuestion input/output so callers can reuse it across tools and tests.
 */

export interface AskUserOption {
  /** Stable machine identifier returned in the answer. */
  id: string;
  /** Human-readable label shown in the prompt. */
  label: string;
  /** Optional short helper text shown beside the label. */
  description?: string;
}

export interface AskUserInput {
  /** Question text shown to the user. */
  question: string;
  /** Header short label (≤12 chars, used in CLI summary). */
  header?: string;
  /** 2-4 mutually exclusive choices. */
  options: AskUserOption[];
  /** When true, accepts multiple selections separated by space or comma. */
  multiSelect?: boolean;
  /** Fallback option id when the user submits an empty answer. */
  default_id?: string;
}

export interface AskUserAnswer {
  /** Selected option id (single-select) or ids (multi-select). */
  selection: string | string[];
  /** User's raw input, kept for debugging / parity with upstream tools. */
  rawInput: string;
  /** True when the user aborts with Ctrl+C. */
  aborted: boolean;
  /** Optional explanatory text captured from the user (future use). */
  notes?: string;
}

export interface AskUserConfig {
  /** Reader callback — replace in tests with a stub. */
  readLine: (prompt: string) => Promise<string>;
  /** Allow callers to inject a fake TTY detection. */
  isTTY?: () => boolean;
  /** Override default 5-minute timeout (ms). */
  timeoutMs?: number;
  /** Maximum retries when parsing fails (default 3). */
  maxParseRetries?: number;
  /** Writer callback for prompt rendering — defaults to process.stderr. */
  write?: (text: string) => void;
}
