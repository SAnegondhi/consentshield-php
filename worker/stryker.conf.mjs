// ADR-1014 Phase 4 Sprint 4.1 — Stryker mutation testing baseline for the
// Cloudflare Worker security-critical surfaces (HMAC verify, origin check,
// timestamp window). Other Worker modules (banner / events / observations
// / db / signatures / storage-mode / zero-storage-bridge) depend on
// Cloudflare runtime bindings (KV, Hyperdrive, ExecutionContext) and are
// covered by the Phase 3 E2E suites + the Miniflare harness; mutating
// them under Node would mostly produce build-time mutants we can't kill
// at the unit layer. Phase 4 expands this scope sprint-by-sprint:
//
//   - Sprint 4.1 (THIS): hmac.ts + origin.ts (pure logic, Web Crypto only).
//   - Sprint 4.2: supabase/functions/deliver-consent-events/ (Deno).
//   - Sprint 4.3: app/src/app/api/v1/** + RPC wrappers.
//   - Sprint 4.4: nightly CI + threshold gate.

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  plugins: [
    '@stryker-mutator/vitest-runner',
    '@stryker-mutator/typescript-checker',
  ],
  // origin.ts is split: validateOrigin (L85-121) + rejectOrigin (L123-128)
  // are pure functions; the upper half (L1-83) is I/O against KV / Hyperdrive
  // / REST and needs Cloudflare runtime bindings — covered by Phase 3 E2E,
  // not by Sprint 4.1's unit-layer mutation scope.
  mutate: ['src/hmac.ts', 'src/origin.ts:85-128'],
  reporters: ['html', 'json', 'progress', 'clear-text'],
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
  thresholds: {
    high: 90,
    low: 80,
    break: 80,
  },
  coverageAnalysis: 'perTest',
  timeoutMS: 60_000,
  concurrency: 4,
  cleanTempDir: true,
  tempDirName: '.stryker-tmp',
  ignorePatterns: [
    'node_modules',
    'reports',
    '.stryker-tmp',
    'dist',
    'wrangler.toml',
    '*.log',
  ],
}
