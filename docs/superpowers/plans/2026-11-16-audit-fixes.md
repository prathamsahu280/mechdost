# Audit fixes — 2026-11-16 (plan)

Source: `docs/qa/state-audit-run-2026-11-15.md` (chunks A–F) and the chunk G run in progress (real-sign-in screens,
mocked API). User: fix everything the audits found with Sonnet agents in batches, verify, deploy, then audit against
the real API and the real website (decisions 2026-11-16).

Rules for every batch: TDD (the failing audit row or a unit test first), en + hi, CLAUDE.md hard rules, the skills
named in each brief, targeted tests only on this PC (no `pnpm check`, `next build`, Playwright), worktree per agent,
coordinator merges, runs the gate, measures the JS budget and re-runs the affected audit rows.

## Batch 0 (in parallel; must merge before batch 1)

### 0a · Real-sign-in text bundles (P0, launch blocker for real sign-in)

- Pages do not pass every namespace their client components use to `ClientMessages`, so real-sign-in screens show raw
  keys (`workshopTier1.f_low`, MISSING_MESSAGE for workshopTier1, supportThread, workshopAnalytics, portal, refunds,
  plus accountApi, shopTier1, storefront, coupons, shopGiveUp, adminEmails, adminExports, adminTier2, trust, checkout…).
- Guard (WIP on branch `wip/i18n-guard`): `apps/web/test/client-messages-coverage.test.ts` follows each page's imports
  and fails on a missing namespace. False positives come from `portal-guard.tsx`, which mixes the `PortalGuard`
  component (uses `portal` and `auth`) with style constants imported by 82 files.
- Fix: move the style constants (`portalCard`, `portalPrimary`, `portalQuiet`, `portalField`, …) to
  `components/portal/portal-styles.ts`, update the imports; then add the missing namespaces to each page/shell list
  (only what the page renders; keep public pages lean); make the guard pass with no allowlist.
- Also: label overlap `workshopTier1.f_low`/`f_high` (G) is the raw keys — re-check after the fix.

### 0b · Audit harness, tooling and CI

- Mocked API gaps in chunk G (`apps/web/e2e/state-audit/api-mode`): answer `GET /me/notifications`, `/me/cart`,
  `/me/wishlist` (+ `?since=`), `/workshop/home-settings`, `/service-requests`, `/quotes`, `/workshops/{slug}` and any
  other unmocked call the G log lists.
- Checker fixes (`e2e/state-audit/geometry.ts`, harness): wrapped inline links measured per line box
  (`getClientRects()`); skip controls behind an open modal; Hindi gate ignores the visitor's echoed search words;
  decorative `pointer-events: none` overlays judged by paint overlap, not hit-testing; rows not about the privacy
  banner answer it first ("Essential only"); the "compare list holds 1 → tray" rule becomes "1 → no tray, a visible
  confirmation; 2+ → tray" (decision 2026-11-15).
- Tooling: `state-audit-run.mjs G` builds `.next-api` itself when missing; `state-audit-api-build.mjs` resolves
  `copy-map-worker.mjs` from its own folder.
- CI (Q171, default yes): a job that builds `NEXT_PUBLIC_AUTH_MODE=firebase` + `NEXT_PUBLIC_DATA_MODE=api`.

## Batch 1 (in parallel, after batch 0 is merged; disjoint files)

### 1a · Catalogue components

- Badges ("Bestseller", vehicle type, "Fitment not listed") drawn over the SKU on the product picture when cards are
  narrow (≈11,000 findings; `product-visual.tsx`, `product-card.tsx`, buy box, related, compare tray).
- Compare table: long product names cut with "…" (CMP-TABLE) — names never truncated.
- Workshop finder at 320 px: service list cut with "…" (WS-FINDER).
- Compare with one product: no tray, but a visible "added — pick one more" next to the control (en + hi, live region).

### 1b · Site chrome and banner

- Header at exactly 1024 px too wide (cart button outside the header, sideways scroll; worst signed in or with a
  two-digit cart count).
- Privacy banner must not cover any button on phones (cart checkout, bulk quote, compare rows, workshop booking form):
  reserve bottom space equal to the open banner (plus tab bar / tray); "Ask MechDost" launcher above the banner.
- Verify with a real keyboard (Tab) whether focused links hide under the sticky header in the admin and account side
  menus at 1024/1280 px (Hindi); fix `scroll-padding-top` if the header is taller than 96 px there.

### 1c · Portals and forms

- Job photos: "Open photo" and "Remove photo" buttons overlap (API-SVC-PHOTOS / workshop job card).
- Missing visible focus ring on form fields (PRT-WORKSHOP-002 and the G rows listing "no visible focus ring").
- Demo login account picker at 320 px: names overflow the buttons (LOGIN-FORM).
- Any further real findings G reports in portal screens.

## After the batches

1. Coordinator: merge, `pnpm check`, JS budget, re-run the affected audit rows (A–G) and compare counts.
2. Deploy.
3. Real-API pass and audits against the real website (decisions 2026-11-16 limits).

## Re-run results after batches 0–1 (2026-11-16, fixed checker, fixed site)

| Chunk | Failed before | Failed now        |
| ----- | ------------- | ----------------- |
| A     | 94 / 365      | 12 / 365          |
| B     | 368 / 444     | 73 / 444          |
| C     | 220 / 320     | 139 / 320         |
| G     | (old harness) | running in slices |

## Batch 2 (after G)

- **2a · Compare tray with one product (decision 2026-11-15).** The tray still opens with one product (≈50 sync findings,
  SHOP-CARD / SHOP-ACTION / SHOP-TRAY); batch 1a added the hint but did not hide the tray. Show the tray from 2 only.
- **2b · Compare table sticky product row.** With names now wrapping, the sticky row grows and table rows / remove
  buttons scroll under it; `scroll-padding-top` covers the site header only. Make the page's top scroll padding include
  the sticky row (CSS variable from its height), or cap the sticky row (names wrap below the sticky part).
- **2c · Checker scrolling.** Before "covered" checks, bring the element into view with `scrollIntoView({block:
'center'})` (honours scroll padding, like keyboard focus) instead of Playwright's own scroll, which ignores it
  (header "covers" the cart bulk-quote link and compare rows only in the checker).
- G findings to be added here when the slices finish.

## After batch 2 is deployed: visual review pass (user 2026-11-16)

The audit checks rendered pages by rules (geometry, text, focus, Hindi, axe) and keeps screenshots of failures only;
nobody has looked at the pages as a person would. User: "u can do what u proposed after the fix is done and deployed".
Capture full-page screenshots of every page in 390/1440 px × light/dark × en/hi × signed out/in (passing or not),
make one contact sheet per page, review every sheet by eye (layout, spacing, colours, text, alignment, empty states),
log findings with screenshots in the QA report, and fix the real ones in the next batch. Then the real-API pass.

## G re-run (fixed site, harness before batch 2C), 2026-11-16

| Slice                                                                      | Rows                                                        | Failed / items |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------- |
| g1 account, wishlist, orders, guest, partner                               | API-ACC-, API-WISHLIST-, API-ORD-, API-GUEST-, API-PARTNER- | 180 / 259      |
| g2 admin analytics, audit, coins, coupons, customers                       | API-ADM-AN/AU/CO/CU                                         | 172 / 272      |
| g3 admin demand, errors, exports, layout, photos, policies                 | API-ADM-D/E/L/P                                             | 149 / 240      |
| g4 admin queue, quotes, refunds, reviews, shops, staff, support, workshops | API-ADM-Q/R/S/W                                             | 292 / 468      |
| g5 shop portal, service, workshop                                          | API-SHOP-, API-SVC-, API-WS-                                | 374 / 539      |
| g6 navigation                                                              | API-NAV-                                                    | 249 / 272      |

Most failures are harness (server-side 500s from the browser-only mock, side-menu "covered" from Playwright's scroll,
code allowlist, mock data, unmocked shop endpoints) — batch 2C. Real ones went to 2A (signed-in header and account menu
overflow, scroll regions, refund list, analytics tiles) and 2B (Hindi wording, compare tray, compare strip).
