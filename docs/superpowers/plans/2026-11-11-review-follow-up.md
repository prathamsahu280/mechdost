# Review follow-up (bugs + tooling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-verify and fix the bugs found by the 2026-11-11 whole-repo review, and make the project rules hold mechanically through tooling.

**Architecture:** Each bug is first reproduced by a failing test in the package that owns the code (shared/db/api/web). A finding that cannot be made to fail is closed with a ruling, not fixed. API fixes stay in repositories and the error mapper (no logic in handlers). Web fixes keep demo behaviour and get the accessibility-lead review before UI edits. Tooling lives in a shared `.claude/settings.json`, `.githooks/` and `.github/workflows/ci.yml`.

**Tech Stack:** TypeScript, Hono + zod-openapi, Drizzle (PGlite tests), Next.js 16, Vitest, Playwright, GitHub Actions, Claude Code hooks.

**Spec:** `docs/research/repo-review-2026-11-11.md` (findings B1–B16, C1–C6, A*, T1–T15). Feature specs it argues from: `docs/specs/04-orders-routing-fulfilment.md` (delivery override), `05` (cursor 422), `09-support.md`, `13-rbac-security-abuse.md`, `16-performance-scalability.md`. User answers: `docs/decisions.md` § 2026-11-11.

## Global Constraints

- Money is integer paise; state changes only through the machines as conditional UPDATEs with `version` (CLAUDE.md rule 3).
- Permissions are checked in the API; foreign or out-of-scope ids → 404 (rule 4).
- Every user-facing string is in `packages/shared/src/i18n/{en,hi}.json` (rule 10). New UI actions are tracked (rule 9).
- No `any`, no non-null assertions, no SQL outside repositories; ESLint must report zero warnings (rule 14).
- Commit only through `set -o pipefail; pnpm format:check && pnpm exec turbo run typecheck lint test --concurrency=1 && git add -A && git commit && git push`. Never add an AI attribution line (rule 12).
- Low memory: e2e always with `--workers=1`, one spec file per run. Do not restart a run the system kills.
- Out of scope here (queued): B3 (Firebase console + research), the B2 "re-issue code" action, moving the COD fee (Q66), C4/C5 (wired when coins and invoices are built), A1–A12 except where noted.

## Review Focus

1. A bad cursor during "Load more" must show the load-failed state, not append page 1 again. Test in Task 1.
2. Overriding delivery on an order in another city, or one not out for delivery, must be a 404 or 409 with nothing written. Test in Task 2.
3. A `?next=` holding encoded control characters, backslashes or an absolute URL must land on the role's home page. Test in Task 7.
4. Corrupt saved cart or session data must never blank the site; the page renders and the bad data is dropped. Test in Task 8.
5. A filter click while "Load more" is in flight must win. Test in Task 9.

---

### Task 1: API errors and cursors (B5, B6, deferred minor "422 restart")

**Files:**

- Modify: `apps/api/src/errors.ts` (map `IllegalTransitionError`, `ActorNotAllowedError` → 409 `INVALID_TRANSITION`)
- Modify: `packages/db/src/repo/cursor.ts` (`decodeCursor(raw: string, kind?: 'number' | 'timestamp' | 'text'): Keyset`, which validates `k` for the kind)
- Modify: callers `packages/db/src/repo/catalogue.ts:254`, `customer-orders.ts:57`, `shop-orders.ts:94` (pass the kind of their sort key)
- Modify: `apps/web/src/lib/catalogue/api-source.ts` (`fetchCataloguePage(…, { restartOnBadCursor?: boolean })`, default true); `app/[locale]/shop/actions.tsx` passes `false`
- Test: `apps/api/test/support.test.ts`, `apps/api/test/catalogue.test.ts`, `packages/db/test/catalogue.test.ts`, `apps/web/test/catalogue-api-source.test.ts`

**Interfaces:**

- Produces: error code `INVALID_TRANSITION` (409); `decodeCursor(raw, kind)`.

- [ ] Step 1: Write failing tests.
  - `'an illegal ticket move is a 409, not a 500'`: POST status `closed` on an `open` ticket → 409, `error.code === 'INVALID_TRANSITION'`.
  - `'a cursor from another sort is a 422'`: GET `/v1/catalogue/products?sort=price_asc&cursor=<cursor from newest>` → 422 `INVALID_CURSOR`.
  - db `'decodeCursor rejects a non-numeric key for a number sort'`.
  - web `'load more does not restart at page 1 on a bad cursor'`: a 422 with `restartOnBadCursor:false` throws.
- [ ] Step 2: Run `pnpm --filter @mechdost/api test -- support catalogue`, `pnpm --filter @mechdost/db test -- catalogue`, `pnpm --filter @mechdost/web test -- catalogue-api-source`. Expected: the new tests FAIL (500, a 200 or cast error, page-1 restart).
- [ ] Step 3: Implement the mapping, the kind check (number: `/^-?\d+(\.\d+)?$/`; timestamp: `Date.parse` finite; text: as today), and the option.
- [ ] Step 4: Re-run the same commands. Expected: PASS.
- [ ] Step 5: Update spec 05/02 notes if behaviour text changes; ledger line; commit `fix(api): illegal moves are 409, cursors validated per sort`.

### Task 2: Admin delivery override (B2)

**Files:**

- Modify: `packages/shared/src/state/index.ts` (`out_for_delivery → delivered` by `['shop','system','admin']`)
- Modify: `packages/db/src/repo/routing.ts`: add `overrideOrderDelivery(db: Tx, input: { scope: CityScope; code: string; reason: string; expectedVersion: number; staffUserId: string }): Promise<{ status: 'delivered'; version: number }>`. In one transaction: `findOrder(tx, scope, code, true)`; status must be `out_for_delivery` (else 409 `WRONG_STEP`); shipment override (reuse the `overrideDelivery` update and audit inside the same tx); `transitionOrder` with actor admin; `recordServerEvent('admin_delivery_override')`.
- Modify: `apps/api/src/routes/admin-orders.ts`: `POST /admin/orders/{code}/deliver-override` body `{ reason: string 5–300, version: int ≥ 1 }`, permission `orders:route`.
- Test: `packages/db/test/routing.test.ts`, `apps/api/test/admin-orders.test.ts`, `packages/shared/test/state.test.ts`

- [ ] Step 1: Write failing tests.
  - db `'a locked delivery code can be overridden by staff'`: 5 wrong codes → locked; `overrideOrderDelivery` → order `delivered`, shipment `deliveredVia='override'`, one audit row.
  - api `'deliver-override: other city is 404, wrong step is 409, short reason is 422'`.
  - shared: admin may move `out_for_delivery → delivered`.
- [ ] Step 2: Run the three test files. Expected: FAIL (function or route missing, machine refuses admin).
- [ ] Step 3: Implement.
- [ ] Step 4: Re-run. Expected: PASS.
- [ ] Step 5: Spec 04 notes the route; queue "re-issue delivery code" in progress Next; commit `feat(api): admin delivery override for locked or lost codes`.

### Task 3: API hardening (C1, C2, C3, C6)

**Files:**

- `apps/api/src/live/publisher.ts`: `inboxRemovals` drops `inbox/{uid}/…` when `inbox/{uid}` is in the same batch.
- `apps/api/src/config.ts`:
  - production requires `TRUSTED_PROXY_HOPS ≥ 1`;
  - when `K_SERVICE` is set and `NODE_ENV !== 'production'` → `ConfigError`.
- `apps/api/src/routes/admin-notifications.ts`: writes require an all-cities `notifications:manage` grant (reuse the helper content/settings use).
- Tests: `apps/api/test/live.test.ts`, `apps/api/test/platform.test.ts` (config), `apps/api/test/admin-notifications.test.ts`.

- [ ] Step 1: Write failing tests:
  - `'one batch never holds a path and its ancestor'`;
  - `'production refuses TRUSTED_PROXY_HOPS=0'`;
  - `'Cloud Run without NODE_ENV=production refuses to start'`;
  - `'a city-scoped notifications grant cannot edit templates'` (403 or 404 per the helper's convention).
- [ ] Step 2: Run them. Expected: FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Re-run. Expected: PASS.
- [ ] Step 5: Update `.env.example` comments, the deploy notes in spec 16, ledger; commit `fix(api): live wipe batches, proxy hops, Cloud Run env, notifications scope`.

### Task 4: Order groups and holds (B7, B8)

**Files:**

- `packages/db/src/repo/` (the function that recomputes a group: `refreshOrderGroup(tx: Tx, groupId: string): Promise<void>`):
  - `totalPaise` = the sum of non-cancelled, non-rejected sub-order totals;
  - `paymentStatus` = `cod_collected` when every live sub-order is delivered and the method is COD, else unchanged.
  - Called from `deliverShopOrder`, the customer and staff cancel, `rejectOrder`, and Task 2's override.
- `routing.ts` `moveReservations`: kept holds get `expires_at = now() + ttl` (TTL from settings, as the original hold).
- Tests: `packages/db/test/customer-orders.test.ts`, `shop-orders.test.ts`, `routing.test.ts`.

- [ ] Step 1: Write failing tests:
  - `'a two-shop group shows the remaining total after one part is cancelled'`;
  - `'a delivered COD group is cod_collected'`;
  - `'routing keeps an existing hold alive for the accept window'`.
- [ ] Step 2: Run. Expected: FAIL. If the group table's fields differ from the review's reading, rule and ledger it.
- [ ] Step 3: Implement (row lock order: order row → group row, as `lockOrder` documents).
- [ ] Step 4: Re-run, plus the whole db suite. Expected: PASS.
- [ ] Step 5: Spec 03/04 note; commit `fix(db): order group totals and status follow their sub-orders; kept holds extended`.

### Task 5: Support reply limits (B9)

**Files:**

- `packages/shared/src/settings.ts`: setting `support.customerRepliesPerTicketPerDay` (int, default 20, min 5, max 100), admin-editable.
- `packages/db/src/repo/support.ts`:
  - `customerReplyTicket` counts today's (IST) customer replies on the ticket and throws `RateLimitedError`/409 `REPLY_LIMIT` at the cap;
  - `messagesOf` returns the newest 200 in order, plus `olderCount`.
- Tests: `packages/db/test/support.test.ts`, `apps/api/test/support.test.ts`.

- [ ] Steps: failing tests `'a customer cannot post more than the daily reply cap on one ticket'` and `'a long thread returns the newest 200 messages'` → FAIL → implement → PASS → spec 09 + settings doc → commit `fix(support): daily reply cap per ticket and paged threads`.

### Task 6: Low findings (API/DB/shared)

Each gets its own failing test first. Close any that will not fail.

- **Custom staff roles can be blocked:** `blockCustomer` uses `isStaffGrant` for the staff exemption. Test in `packages/db/test/customer-blocks.test.ts`.
- **A WhatsApp receipt is lost on failure:** mark it processed in the same transaction as `applyDeliveryReceipt`. Test in `apps/api/test/whatsapp.test.ts`.
- **Content publish ABA:** publish compares the draft id (or `updated_at`) as well as the version. Test in `packages/db/test/content.test.ts`.
- **Hindi joiners stripped:** text cleaning keeps U+200C/U+200D and does not cut surrogate pairs. Tests in `packages/shared/test/policy.test.ts`; content cleaning is covered by the shared tests.
- **Live outbox grows without bound:** rows past 20 attempts or older than 24 h are dropped by the sweep. Test in `packages/db/test/live.test.ts`.
- **Coin replay check is user-only:** a replay with a different delta or kind → 409 `IDEMPOTENCY_MISMATCH`. Test in `packages/db/test/integrity.test.ts` (coins block).

- [ ] Commit `fix: review low findings (staff block, receipts, content ABA, Hindi joiners, live cap, coin replay)`.

### Task 7: Web sign-in (B1, B15)

**Files:**

- `apps/web/src/demo/session.ts`: `safeNext(next: string | null): string | null`. Rejects any char < 0x20 or 0x7f, `\`, a leading `//`, and anything that is not same-origin after `new URL(next, 'https://x.invalid')` (only the host `x.invalid` passes). It returns `pathname + search + hash`.
- `apps/web/src/lib/auth/firebase-client.ts`: `auth/code-expired` → `expired`.
- `components/auth/login-flow.tsx`: sign-up retry skips `linkEmailPassword` when the password provider is already linked.
- Test: new `apps/web/test/safe-next.test.ts`; `apps/web/test/real-account.test.ts` (or the closest existing auth unit file).

- [ ] Step 1: Failing tests:
  - `safeNext` returns null for `'/\t/evil.example'`, `'/\n/evil.example'`, `'/%09/x'` (after decoding, as `useSearchParams` gives it), `'https://evil.example'`, `'//evil'`, `'/\\evil'`;
  - `safeNext` returns `'/account?tab=orders'` unchanged;
  - expired code maps to `expired`.
- [ ] Step 2: FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: PASS.
- [ ] Step 5: Also run `e2e/real-auth`? No: it needs the emulator. Run `e2e/sign-in.spec.ts` (demo) with `--workers=1`. Then the ledger; commit `fix(web): same-origin post-login redirect; expired sign-up codes; sign-up retry`.

### Task 8: Web demo-store robustness and admin quote (B4, B10, B11, B12, root error page)

UI → run the accessibility-lead review first (scope: the files below).

**Files:**

- `apps/web/src/demo/store.ts`:
  - Zod schemas for cart line, order, quote; read drops invalid entries; quantity clamped 1–99;
  - `write()` returns `boolean`, and the add-to-cart UI shows the existing error toast on false;
  - `acceptOffer` requires a delivery address + serviceable PIN + `customerAllowed` (same checks as `checkout-form.tsx`);
  - the customer "advance" step refuses unless the shop accepted.
- `apps/web/src/demo/session-state.ts`: Zod-parse accounts.
- `components/portal/admin-console.tsx`: rupee parsing with `/^\d{1,7}(\.\d{1,2})?$/`; Send disabled on invalid or zero; inline error text (en + hi).
- `components/commerce/order-view.tsx`: "advance" only in the demo-guide mode (as the store rule).
- Create: `app/[locale]/error.tsx` (client; focused h1, "Try again" + "Reset saved data"; strings in en + hi; tracks `error_boundary_retry`).
- Tests: `apps/web/test/demo-store.test.ts` (new), `apps/web/e2e/demo-flows.spec.ts` additions.

- [ ] Steps:
  - Failing unit tests: negative quantity is clamped; an order without `customer` is dropped; `acceptOffer` without an address throws; advance on an offered order is refused.
  - Failing e2e: typing `.` in a quote price shows an inline error and the console stays.
  - Run → FAIL → implement → PASS.
  - Run `hindi-coverage` and `demo-flows` (workers 1).
  - Commit `fix(web): demo store validation, quote price input, root error page`.

### Task 9: Shop browser and booking date (B13, B16, B14)

UI → accessibility-lead review (focus and announcements on filter reset).

**Files:**

- `components/catalogue/shop-browser.tsx`:
  - demo mode derives filters from `useSearchParams()` (`readUrl` becomes a pure `stateFromParams(params)`);
  - `loadMore` captures `listingKey` before the await, drops the result if the key changed or `navigating`, and builds the URL from `basePath` + `server.query` + `pages`.
- `components/workshops/booking-form.tsx`: min and default date set after mount (IST today); `max` = today + 60 days.
- Tests: `apps/web/e2e/demo-flows.spec.ts` (`'header Shop link clears a demo filter'`, `'Back from a product keeps the demo filter'`), `apps/web/e2e/catalogue-api.spec.ts` (`'a filter click during Load more wins'`: delay `loadMoreCards` with `page.route` on the server-action POST), and a booking unit or e2e test with a fixed clock (`page.clock`).

- [ ] Steps:
  - Failing e2e (demo build) → FAIL → implement → PASS.
  - The API-mode test needs an api build + API. If memory refuses, rule and ledger it, and keep a unit test of the guard.
  - Commit `fix(web): shop filters follow the URL; Load more never overrides a filter; booking dates`.

### Task 10: Claude Code settings and git hooks (T1, T2)

**Files:**

- Create: `.claude/settings.json`:
  - `attribution` with commit and pr empty;
  - `permissions.deny` for `Read(./.env)`, `Read(./**/*firebase-adminsdk*.json)`, `Read(./**/*service-account*.json)`;
  - hooks `PreToolUse` (Bash, `git commit`) → `node "$CLAUDE_PROJECT_DIR/.claude/hooks/no-ai-attribution.mjs"`;
  - `SessionStart` (matcher `compact|startup|resume`) → `ledger-now.mjs`;
  - `Stop` → `ledger-reminder.mjs` (warn only, exit 0).
- Create: `.claude/hooks/{no-ai-attribution,ledger-now,ledger-reminder}.mjs` (stdin JSON; paths from `CLAUDE_PROJECT_DIR`).
- Create: `.githooks/commit-msg` (fail on `co-authored-by` or `generated with .*claude`, case-insensitive).
- Modify: `.githooks/pre-commit`, which also fails when the staged names match `(^|/)\.env$|firebase-adminsdk|service-account.*\.json$|\.pem$`.
- Test: `scripts/test-hooks.mjs`? No. Use `packages/shared/test/source-hygiene.test.ts`-style tests in a new `tooling/test/hooks.test.ts`? Ruling: put the tests in `apps/api/test/tooling-hooks.test.ts`? Decide at execution, keeping it inside an existing Vitest project.

- [ ] Step 0: Verify every key and hook shape against the Claude Code docs (claude-code-guide agent or docs fetch) before writing. Record sources in the ledger.
- [ ] Step 1: Failing tests:
  - the attribution hook script exits 2 for `git commit -m "x\n\nCo-Authored-By: Claude …"` and 0 for a clean message;
  - `commit-msg` exits 1 on the same message;
  - `pre-commit` refuses a staged `.env`.
- [ ] Step 2: FAIL (scripts missing).
- [ ] Step 3: Implement.
- [ ] Step 4: PASS. A real `git commit` with a clean message succeeds.
- [ ] Step 5: Docs: CLAUDE.md hard rule 12 mentions the hooks; `docs/runbooks/` collaborator note; commit `chore(tooling): shared Claude Code settings and git hooks enforce attribution and secret rules`.

### Task 11: CI and scripts (T4–T8, T15 audit)

**Files:**

- `.github/workflows/ci.yml`:
  - `node-version-file: .nvmrc`;
  - add `pnpm exec turbo run build --concurrency=2`;
  - new job `e2e-demo`: build web, `playwright install --with-deps chromium`, `playwright test e2e/shell.spec.ts e2e/demo-flows.spec.ts e2e/hindi-coverage.spec.ts --workers=2`, then `node apps/web/scripts/measure-js.mjs`;
  - add `pnpm audit --audit-level=high` (non-blocking first, `continue-on-error: true`, with a ruling).
- `package.json`: `check` gets `--concurrency=1`.
- `apps/web/playwright.config.ts`: `workers: process.env.CI ? 2 : 1`.
- `turbo.json`: `globalDependencies` adds `eslint.config.mjs`, `.prettierrc.json`.
- Docs: `CLAUDE.md` commit chain → `pnpm check && git add -A && git commit && git push`; advisor `checklist.md` the same.

- [ ] Steps:
  - Validate the YAML locally (`node -e` parse with the yaml package if present, else `actionlint` is not installed → ruling).
  - Run `pnpm check`.
  - Commit `ci: build, demo e2e, Node from .nvmrc, audit; low-memory defaults in scripts`.
  - Report CI as unproven (no `gh`; GitHub plugin auth fails) and ask the user for a way to read runs.

### Task 12: Skills and docs hygiene (T3, T9–T13, C4 doc)

**Files:**

- `.claude/skills/mechdost-advisor/SKILL.md`, `.claude/skills/README.md`: "all hard rules (1–16)"; add a rule-16 data-for-ML section to `references/checklist.md` and move misfiled checklist items.
- Advisor `learnings.md`:
  - mark the promoted entries;
  - move the promoted and obsolete ones to `references/learnings-archive.md`;
  - add a note in SKILL.md to read the archive only when needed.
- Rename `.claude/skills/msg91-messaging` → `notifications-messaging`: fix the description (Meta Cloud API direct for WhatsApp, MSG91 SMS later; no `packages/notify`). Update `CLAUDE.md` references.
- `CLAUDE.md`:
  - remove the duplicate "Skills to use" list (keep the protocol table; move the list to `docs/runbooks/collaborator-setup.md`);
  - mark `pnpm lhci` and pgTAP "planned".
- `.claude/skills/website-testing/references/commands.md`: regenerate the suite map from `apps/web/e2e/*.spec.ts`.
- `docs/progress.md`: move the Completed log older than 2026-11-01 to `docs/progress-archive.md`; keep NOW + Next + the last entries.
- `docs/specs/20-loyalty-coins.md`: correct "ledger + redemption built" → "ledger built; redemption, restore and expiry not wired" (C4).

- [ ] Steps:
  - `pnpm format:check`;
  - grep that no `msg91-messaging` references remain;
  - commit `docs(skills): advisor walks all 16 rules; messaging skill renamed; lean CLAUDE.md and ledger`.

### Finish

- [ ] Final whole-branch review on Fable 5.2 (requesting-code-review's code-reviewer prompt, `model: fable`), then one fix pass; website-testing on the touched suites; advisor learnings; ledger.
