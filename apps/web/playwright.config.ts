import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the production build (website-testing skill): desktop 1440 and mobile 390 (concept breakpoints).
 * `pnpm build` first; the web server is `next start` so tests see real caching, headers and static output.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Low-memory development machine: one browser at a time locally; two on CI runners.
  workers: process.env.CI ? 2 : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // Visitors in these suites have already made their privacy choice, so the consent banner (fixed at the bottom)
  // does not cover what they click; e2e/consent.spec.ts starts from a clean browser to test the banner itself.
  use: {
    baseURL: `http://localhost:${process.env.E2E_PORT ?? '3100'}`,
    trace: 'retain-on-failure',
    storageState: 'e2e/fixtures/consent-decided.json',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `pnpm exec next start --port ${process.env.E2E_PORT ?? '3100'}`,
    url: `http://localhost:${process.env.E2E_PORT ?? '3100'}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
