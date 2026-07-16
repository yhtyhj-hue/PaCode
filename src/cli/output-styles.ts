/**
 * I5: Output styles — switchable REPL rendering profiles.
 *
 * Each style controls: progress verbosity, token-cost line,
 * and tool-card rendering. The style is a REPL-level setting
 * (not a session setting) so users can flip mid-conversation
 * without restarting.
 */

export type OutputStyle = 'default' | 'cost' | 'full' | 'minimal';

export interface OutputStyleOptions {
  /** Show token + cost line after each model turn. */
  showCost: boolean;
  /** Show tool activity (running, complete) inline. */
  showToolActivity: boolean;
  /** Show prefetch planning lines (subagent list etc). */
  showPrefetch: boolean;
  /** Cost line format. */
  costFormat: 'tokens-only' | 'tokens-and-cost' | 'tokens-cost-duration';
}

const STYLE_PRESETS: Record<OutputStyle, OutputStyleOptions> = {
  default: {
    showCost: true,
    showToolActivity: true,
    showPrefetch: true,
    costFormat: 'tokens-only',
  },
  cost: {
    showCost: true,
    showToolActivity: true,
    showPrefetch: true,
    costFormat: 'tokens-and-cost',
  },
  full: {
    showCost: true,
    showToolActivity: true,
    showPrefetch: true,
    costFormat: 'tokens-cost-duration',
  },
  minimal: {
    showCost: false,
    showToolActivity: false,
    showPrefetch: false,
    costFormat: 'tokens-only',
  },
};

export function getStyleOptions(style: OutputStyle): OutputStyleOptions {
  return STYLE_PRESETS[style] ?? STYLE_PRESETS.default;
}

export function listStyles(): OutputStyle[] {
  return ['default', 'cost', 'full', 'minimal'];
}