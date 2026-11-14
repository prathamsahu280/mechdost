import { defineConfig, devices } from '@playwright/test';

/**
 * API-mode UI state audit (runbook docs/runbooks/ui-test-catalogue.md § 9.7). Same single-project shape as
 * `playwright.state-audit.config.ts`, but it serves the real-mode build (`node scripts/state-audit-api-build.mjs`
 * writes `.next-api`) on its own port, and the mocked API answers inside the browser (`e2e/state-audit/api-mode/`).
 * Manual only: no CI job (decision 2026-11-15, Actions minutes).
 */
export default defineConfig({
  testDir: './e2e/state-audit',
  testMatch: '**/*-api.audit.ts',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  outputDir: process.env.STATE_AUDIT_OUTPUT ?? 'test-results/state-audit-api',
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['json', { outputFile: process.env.STATE_AUDIT_REPORT ?? 'test-results/state-audit-api-report.json' }],
  ],
  use: {
    baseURL: 'http://localhost:3101',
    trace: 'off',
    screenshot: 'off',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'audit-api' }],
  webServer: {
    command: 'pnpm exec next start --port 3101',
    env: { NEXT_DIST_DIR: '.next-api' },
    url: 'http://localhost:3101',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
