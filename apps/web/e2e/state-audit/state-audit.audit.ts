/**
 * UI state audit (2026-11-14): one test per checklist item of `docs/qa/ui-state-checklist.md`; each title starts
 * with the item's id. Run with `playwright.state-audit.config.ts` (runbook: docs/runbooks/ui-test-catalogue.md § 9).
 *
 *   STATE_AUDIT_TIER=core   only the per-push subset (titles carrying `@core`)
 *   STATE_AUDIT_ONLY=SHOP-  only ids starting with this prefix (comma-separated list allowed)
 *   STATE_AUDIT_KNOWN=allow findings of known, filed bugs (known-issues.ts) are annotations, not failures
 */
import { test } from '@playwright/test';
import { buildCases, titleOf } from './cases.ts';
import { runCase } from './harness.ts';

const tier = process.env.STATE_AUDIT_TIER ?? 'full';
const only = (process.env.STATE_AUDIT_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const cases = buildCases().filter(
  (c) =>
    (tier !== 'core' || c.tier === 'core') && (only.length === 0 || only.some((p) => c.id.startsWith(p))),
);

for (const c of cases)
  test(titleOf(c), async ({ page }, info) => {
    test.setTimeout(Number(process.env.STATE_AUDIT_TIMEOUT ?? 90_000));
    await runCase(page, c, info);
  });
