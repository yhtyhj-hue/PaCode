/**
 * Gate: G6 ML classifier backend
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getClassifierBackend,
  resetClassifierBackend,
  setClassifierBackend,
  describeActiveClassifierBackend,
} from '../src/permission/classifier-backend.js';
import { scoreMlFeatures, ML_CLASSIFIER_CONTRACT } from '../src/permission/classifier-ml.js';
import { formatPermissionsReport, describePermissionMode } from '../src/permission/format-display.js';
import { PermissionMode } from '../src/pkg/types.js';

describe('classifier ml backend', () => {
  beforeEach(() => {
    resetClassifierBackend();
    delete process.env['PACODE_CLASSIFIER'];
    delete process.env['PACODE_CLASSIFIER_CMD'];
  });

  afterEach(() => {
    resetClassifierBackend();
    delete process.env['PACODE_CLASSIFIER'];
    delete process.env['PACODE_CLASSIFIER_CMD'];
  });

  it('scoreMlFeatures flags destructive bash', () => {
    const r = scoreMlFeatures({
      id: '1',
      name: 'Bash',
      input: { command: 'rm -rf /tmp/x' },
    });
    expect(r.backend).toBe('ml');
    expect(r.contract).toBe(ML_CLASSIFIER_CONTRACT);
    expect(r.risk).toBe('destructive');
  });

  it('PACODE_CLASSIFIER=ml selects ml backend', () => {
    process.env['PACODE_CLASSIFIER'] = 'ml';
    const b = getClassifierBackend();
    expect(b.id).toBe('ml');
    const r = b.classify({
      id: '1',
      name: 'Read',
      input: { path: 'a.ts' },
    });
    expect(r.backend).toBe('ml');
  });

  it('PACODE_CLASSIFIER_CMD overrides with JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clf-'));
    const script = join(dir, 'clf.sh');
    writeFileSync(
      script,
      `#!/bin/sh\necho '{"risk":"destructive","confidence":"high","reason":"mock"}'\n`
    );
    chmodSync(script, 0o755);
    process.env['PACODE_CLASSIFIER'] = 'ml';
    process.env['PACODE_CLASSIFIER_CMD'] = script;
    try {
      const r = getClassifierBackend().classify({
        id: '1',
        name: 'Bash',
        input: { command: 'echo hi' },
      });
      expect(r.risk).toBe('destructive');
      expect(r.backend).toBe('ml-cmd');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('setClassifierBackend override works', () => {
    setClassifierBackend({
      id: 'mock',
      contract: 'test',
      classify: () => ({
        risk: 'safe',
        backend: 'mock',
        contract: 'test',
        confidence: 'high',
      }),
    });
    expect(getClassifierBackend().id).toBe('mock');
  });

  it('/permissions mentions active backend', () => {
    process.env['PACODE_CLASSIFIER'] = 'ml';
    expect(describeActiveClassifierBackend()).toContain('backend=ml');
    expect(describePermissionMode(PermissionMode.AUTO)).toContain('backend=ml');
    const lines = formatPermissionsReport(PermissionMode.AUTO);
    expect(lines.some((l) => l.includes('Classifier:'))).toBe(true);
    expect(lines.some((l) => l.includes('PACODE_CLASSIFIER=ml'))).toBe(true);
  });
});
