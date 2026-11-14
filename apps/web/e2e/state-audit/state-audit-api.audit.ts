/**
 * API-mode UI state audit (Q106, 2026-11-15): the cases of the real-sign-in screens (`realApi` in the model, ids
 * `API-…`), run against the real-mode build with a mocked API and a signed-in Firebase user. Manual only
 * (decision 2026-11-15 "Test runs and GitHub Actions minutes"). Config: `playwright.state-audit-api.config.ts`.
 *
 *   STATE_AUDIT_ONLY=API-SHOP-  only ids starting with this prefix (comma-separated list allowed)
 */
import { test } from '@playwright/test';
import { buildCases, titleOf } from './cases.ts';
import { apiHooks } from './api-mode/hooks.ts';
import { runCase } from './harness.ts';

const only = (process.env.STATE_AUDIT_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

for (const c of buildCases().filter(
  (x) => x.realApi && (only.length === 0 || only.some((p) => x.id.startsWith(p))),
))
  test(titleOf(c), async ({ page }, info) => {
    test.setTimeout(Number(process.env.STATE_AUDIT_TIMEOUT ?? 90_000));
    await runCase(page, c, info, apiHooks);
  });
