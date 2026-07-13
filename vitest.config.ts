import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'evals/**/*.eval.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.d.ts', 'vitest.config.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 79,
        branches: 74,
      },
    },
  },
});
