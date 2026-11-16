import { defineConfig, devices } from '@playwright/test';

/**
 * Real-mode visual review capture (workflow `visual-review.yml`, `mode: api`; runbook docs/runbooks/ui-testing.md).
 * The same server, port, mocked API and signed-in sessions as `playwright.state-audit-api.config.ts`, but it runs
 * `e2e/state-audit/visual-review-api.shots.ts`, which only takes screenshots (`VISUAL_SHOTS=<dir>`).
 */
export default defineConfig({
  testDir: './e2e/state-audit',
  testMatch: '**/visual-review-api.shots.ts',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  outputDir: 'test-results/visual-review-api-raw',
  reporter: [[process.env.CI ? 'github' : 'list']],
  use: {
    baseURL: 'http://localhost:3101',
    trace: 'off',
    screenshot: 'off',
    ...devices['Desktop Chrome'],
  },
  globalSetup: './e2e/state-audit/api-mode/server-mock-setup.ts',
  projects: [{ name: 'visual-api' }],
  webServer: {
    command: 'pnpm exec next start --port 3101',
    env: { NEXT_DIST_DIR: '.next-api' },
    url: 'http://localhost:3101',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
