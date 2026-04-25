import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // tsup-emitted dist/ is published, not authored — exclude from
      // the source coverage scope.
      exclude: ['dist/**', 'tsup.config.ts'],
      reporter: ['text', 'html', 'json-summary'],
      // ADR-1006 §Sprint 1.4 — non-negotiable coverage gate. The 94
      // tests authored across Sprints 1.1-1.3 cover well above this;
      // the threshold is the regression-prevention floor.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
