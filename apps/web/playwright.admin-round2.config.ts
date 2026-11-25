import { defineConfig, devices } from '@playwright/test';

/**
 * Admin round 2 review screenshots (`e2e/state-audit/admin-round2.shots.ts`, `ROUND2_SHOTS=<dir>`). Same mocked API
 * and signed-in sessions as `playwright.state-audit-api.config.ts`; the server runs the real-mode build from
 * `NEXT_DIST_DIR` (default `.next-api`) on `ROUND2_PORT` (default 3101), so a "before" and an "after" build can be
 * photographed one after the other.
 */
const port = process.env.ROUND2_PORT ?? '3101';
export default defineConfig({
  testDir: './e2e/state-audit',
  testMatch: '**/admin-round2.shots.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'test-results/admin-round2-raw',
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, trace: 'off', screenshot: 'off', ...devices['Desktop Chrome'] },
  globalSetup: './e2e/state-audit/api-mode/server-mock-setup.ts',
  projects: [{ name: 'admin-round2' }],
  webServer: {
    command: `pnpm exec next start --port ${port}`,
    env: { NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-api' },
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
