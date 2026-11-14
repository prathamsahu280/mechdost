import { defineConfig, devices } from '@playwright/test';

/**
 * UI state audit (docs/qa/ui-state-checklist.md, runbook docs/runbooks/ui-test-catalogue.md § 9): one Chromium
 * project; every test sets its own viewport, theme, language and stored state, so there is no desktop/mobile
 * split. Runs against the production build (`next start`) like the other e2e suites. Separate from
 * playwright.config.ts so `pnpm e2e` does not run the ~2,000 audit tests.
 */
export default defineConfig({
  testDir: './e2e/state-audit',
  testMatch: '**/state-audit.audit.ts',
  fullyParallel: true,
  // Low-memory development machine: one browser locally; CI runners take two.
  workers: process.env.CI ? 2 : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  outputDir: process.env.STATE_AUDIT_OUTPUT ?? 'test-results/state-audit',
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['json', { outputFile: process.env.STATE_AUDIT_REPORT ?? 'test-results/state-audit-report.json' }],
  ],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'off',
    screenshot: 'off',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'audit' }],
  webServer: {
    command: 'pnpm exec next start --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
