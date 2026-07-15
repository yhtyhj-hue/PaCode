/**
 * Git context command tests
 */

import { describe, it, expect } from 'vitest';
import {
  GIT_DIFF_STAT,
  GIT_LOG_ONELINE,
  GIT_DIFF_NAMES,
  SECURITY_DIFF_SCAN,
  COVERAGE_TRACKED_CMD,
  ARCH_WIRE_CMD,
} from '../src/services/agent-scheduler/git-context.js';
import { buildDagPlan } from '../src/services/agent-scheduler/intents.js';

describe('git-context', () => {
  it('prefers origin/main..HEAD with fallback', () => {
    expect(GIT_DIFF_STAT).toContain('origin/main..HEAD');
    expect(GIT_LOG_ONELINE).toContain('origin/main..HEAD');
    expect(GIT_DIFF_NAMES).toContain('origin/main..HEAD');
  });

  it('includes security diff scan', () => {
    expect(SECURITY_DIFF_SCAN).toContain('grep');
  });

  it('includes coverage and arch wire fact-check commands', () => {
    expect(COVERAGE_TRACKED_CMD).toContain('git ls-files coverage');
    expect(ARCH_WIRE_CMD).toContain('agent-scheduler');
  });
});

describe('inspect_project DAG', () => {
  it('includes git diff and glob like Claude Code', () => {
    const plan = buildDagPlan('inspect_project');
    expect(plan.nodes.some((n) => n.id === 'git_diff_stat')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'glob_src')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'coverage_tracked')).toBe(true);
    expect(plan.nodes.length).toBeGreaterThanOrEqual(12);
  });
});

describe('review_implementation DAG', () => {
  it('adds security scan, services tree, and fact-checks', () => {
    const plan = buildDagPlan('review_implementation');
    expect(plan.nodes.some((n) => n.id === 'security_scan')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'services_tree')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'coverage_tracked')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'arch_wire')).toBe(true);
    expect(plan.nodes.length).toBe(19);
  });
});
