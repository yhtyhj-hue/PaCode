import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'evals/**/*.eval.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      // 只计量主源码；排除 worktree / coverage 产物污染全局阈值
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'node_modules/',
        'dist/',
        'coverage/',
        '.claude/**',
        '**/*.test.ts',
        '**/*.d.ts',
        'vitest.config.ts',
        // 纯类型 / 进程入口：无单测价值，计入会扭曲阈值
        'src/pkg/types.ts',
        'src/cli/index.ts',
        'src/cli/tui/index.ts',
        'src/cli/tui/run.tsx',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 79,
        // 目标 ≥74.5%；门禁 74 留缓冲（types/入口已排除）
        branches: 74,
      },
    },
  },
});
