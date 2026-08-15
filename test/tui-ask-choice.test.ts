/**
 * K7 Ink TUI — AskUserChoice 协议测试
 *
 * 覆盖:
 *  - encodeChoiceAsRaw / decodeRawToIndexes 纯函数
 *  - mockCtl 必填字段 + askChoice stub 行为
 *  - App.tsx 选择题渲染(<AskUserChoicePrompt> 被引用)
 */

import { describe, it, expect } from 'vitest';
import {
  encodeChoiceAsRaw,
  decodeRawToIndexes,
} from '../src/cli/tui/controller.js';
import type { TuiController } from '../src/cli/tui/app.js';
import type { AskUserChoicePromptProps } from '../src/cli/tui/regions.jsx';

function mockCtl(): TuiController & { lines: string[]; choices: unknown[] } {
  const lines: string[] = [];
  const choices: unknown[] = [];
  return {
    lines,
    choices,
    appendUser: (t) => lines.push(`U:${t}`),
    appendSystem: (t) => lines.push(`S:${t}`),
    appendError: (t) => lines.push(`E:${t}`),
    appendTool: (n, d) => lines.push(`T:${n}:${d ?? ''}`),
    appendAssistantDelta: (t) => lines.push(`A:${t}`),
    setBusy: () => undefined,
    setStatus: () => undefined,
    setProgressPhase: () => undefined,
    setLiveTasks: () => undefined,
    setToolRunning: () => undefined,
    addTokens: () => undefined,
    askConfirm: async () => true,
    askText: async () => '',
    askChoice: async (input) => {
      choices.push(input);
      return '';
    },
    setMode: () => undefined,
    requestInterrupt: () => undefined,
    injectText: () => undefined,
  };
}

const SAMPLE_OPTIONS = [
  { id: 'tweaks', label: '调整原型细节' },
  { id: 'project_dialog', label: '优化添加项目体验' },
  { id: 'native_picker', label: '接原生目录选择' },
];

describe('encodeChoiceAsRaw', () => {
  it('single-select: returns the chosen label', () => {
    expect(
      encodeChoiceAsRaw({ options: SAMPLE_OPTIONS }, { selectedIndexes: [0] })
    ).toBe('调整原型细节');
  });

  it('multi-select: joins labels with comma-space', () => {
    expect(
      encodeChoiceAsRaw(
        { options: SAMPLE_OPTIONS, multiSelect: true },
        { selectedIndexes: [0, 2] }
      )
    ).toBe('调整原型细节, 接原生目录选择');
  });

  it('empty selection returns empty string', () => {
    expect(encodeChoiceAsRaw({ options: SAMPLE_OPTIONS }, { selectedIndexes: [] })).toBe('');
  });
});

describe('decodeRawToIndexes', () => {
  it('decodes label text', () => {
    expect(decodeRawToIndexes('调整原型细节', SAMPLE_OPTIONS)).toEqual([0]);
  });

  it('decodes 1-based index', () => {
    expect(decodeRawToIndexes('2', SAMPLE_OPTIONS)).toEqual([1]);
  });

  it('decodes comma-separated multiple for multi-select', () => {
    expect(decodeRawToIndexes('1, 3', SAMPLE_OPTIONS)).toEqual([0, 2]);
  });

  it('ignores unknown tokens', () => {
    expect(decodeRawToIndexes('bogus, 1', SAMPLE_OPTIONS)).toEqual([0]);
  });
});

describe('TUI controller askChoice', () => {
  it('exposes askChoice on TuiController interface', () => {
    const ctl = mockCtl();
    expect(typeof ctl.askChoice).toBe('function');
  });

  it('askChoice receives full AskUserInput', async () => {
    const ctl = mockCtl();
    await ctl.askChoice({
      question: '下一步?',
      header: '下一步',
      options: SAMPLE_OPTIONS,
      multiSelect: false,
    });
    expect(ctl.choices[0]).toEqual({
      question: '下一步?',
      header: '下一步',
      options: SAMPLE_OPTIONS,
      multiSelect: false,
    });
  });

  it('round-trips choice: encode → parse via decodeRawToIndexes', () => {
    const raw = encodeChoiceAsRaw(
      { options: SAMPLE_OPTIONS, multiSelect: true },
      { selectedIndexes: [1, 2] }
    );
    const back = decodeRawToIndexes(raw, SAMPLE_OPTIONS);
    expect(back).toEqual([1, 2]);
  });
});

describe('AskUserChoicePrompt props contract', () => {
  it('covers all required fields for single-select', () => {
    const props: AskUserChoicePromptProps = {
      question: '下一步?',
      header: '下一步',
      options: SAMPLE_OPTIONS,
      selectedIndex: 1,
      multiSelected: [],
      multiSelect: false,
      defaultId: 'tweaks',
    };
    expect(props.options).toHaveLength(3);
    expect(props.selectedIndex).toBe(1);
  });

  it('covers multi-select fields', () => {
    const props: AskUserChoicePromptProps = {
      question: 'Pick',
      options: SAMPLE_OPTIONS,
      selectedIndex: 0,
      multiSelected: [0, 2],
      multiSelect: true,
    };
    expect(props.multiSelected).toEqual([0, 2]);
  });
});