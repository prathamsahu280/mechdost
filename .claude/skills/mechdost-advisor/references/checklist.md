# Advisor checklist — red flags per area

Mark each touched item ✅ / ⚠️ / ❌. Anything ❌ blocks implementation until fixed or explicitly ruled.

## Every task

- [ ] Read `docs/progress.md`, `decisions.md`, the spec, and `learnings.md` before acting.
- [ ] The change is in scope of the user's request (no silent widening or narrowing).
- [ ] Docs to update are listed and will change in the same commit (spec, decisions, progress, README index).
- [ ] No user question blocks work: it is queued in `docs/questions-for-user.md` with a default.
- [ ] Commit message has no AI attribution.
- [ ] `pnpm check` (format, typecheck, lint 0 warnings, tests) will be run and its output shown.
- [ ] For UI work: the plan names the world states and the cross-role checks, and the summary says which were
      rendered (theme × language × widths).

## Data / DB / schema (spec 14, research/data-integrity.md, skill drizzle-postgis-supabase)

- ❌ Status written with a plain UPDATE (no `WHERE status = $from AND version = $v`) or outside `packages/shared/state`.
- ❌ Money as float/`numeric` in app code, rupees instead of paise, rates not in basis points.
- ❌ Read-then-write for stock, counters, coupons, wallet (must be a conditional single statement or `FOR UPDATE`).
- ❌ New table without RLS enabled, without `version`/`updated_at` triggers when mutable, or with an unindexed FK.
- ❌ GST invoice number from a sequence or assigned before finalisation.
- ❌ Historical display joining live product/address rows instead of the order snapshot.
- ❌ Notification sent outside the outbox; webhook processed without event-id dedupe.
- ⚠️ Migration that locks big tables (no `lock_timeout`, non-concurrent index on a large table, drop column in the same release).
- ⚠️ Query without an index on its filter columns; offset pagination on growing lists (use cursors).
- ⚠️ Timestamps or "today" computed in UTC instead of IST business days.

- [ ] Any column holding government IDs (PAN, Aadhaar, GSTIN of individuals), bank/UPI details, document numbers or secrets is `*_enc` with `encryptedCheck` and written via `encryptField` (spec 13 "Encryption"); lookups use a blind index, never the plain value.
- [ ] Connections to non-local databases go through `createDb`/`tlsFor` (TLS required).

- [ ] Audit rows are written inside the same transaction as the change they describe, and only when a new change happened (idempotent replays write nothing).

## API (Hono)

- ❌ Handler queries tables directly (must call a repository with an `actor`).
- ❌ Permission checked only in the UI; missing `requirePermission`; cross-tenant id returns 403 instead of 404.
- ❌ Request body not validated with Zod `.strict()` DTOs (mass assignment risk).
- ❌ Mutating money endpoint without an idempotency key.
- ⚠️ Missing rate limit on a public or OTP endpoint; missing Turnstile on a guest form.
- ⚠️ Error leaks internals (stack, SQL) instead of `{ error: { code, message, requestId } }`.

## Auth / RBAC (spec 01, 13, skill firebase-phone-auth-rbac)

- ❌ Trusting a uid/role from the client body; not calling `verifyIdToken(token, true)` for sensitive actions.
- ❌ Roles in client-editable metadata; secrets in `NEXT_PUBLIC_*`.
- ⚠️ OTP endpoints without per-phone/IP/device limits, region policy and enumeration-safe responses.

- [ ] Locks and rate limits decide from the same atomic call that counts (never read-then-count; parallel-request test) — L69.
- [ ] Passwords: never logged or stored by us; one generic error for unknown account / wrong password; per-account lockout; API accepts only `phone` + `custom` tokens; no account creation without a verified phone (decision 2026-11-01).

## Payments (skill razorpay-payments)

- ❌ Amount taken from the client; HMAC over parsed JSON instead of raw body; no amount/currency assert.
- ❌ Refund without remaining-balance check under lock, or without an idempotency key.

## UI / UX (rule 2, design-system.md, ui-ux-pro-max, shadcn skills)

- ❌ New visual language (colours, fonts, radii) not in `design-system.md`.
- ❌ Logging `err.message` / `err.stack` / `String(err)` (database errors embed SQL parameters: phones, message text). Log `safeError(err)` from `apps/api/src/logger.ts` (class, SQLSTATE, frames) plus ids (security review 2026-11-03).
- ❌ A queue/job that retries the same failing item first forever: count attempts outside the rolled-back transaction and park after N.
- ❌ A commit chained after the gates with `;` (it runs even when the gates fail). Always `gates && git add && git commit`, and read the gate output before reporting (2026-11-03: a commit went out after a load-induced test failure).
- ❌ Test fixture codes (MD-/REQ-/SR-…) with I, L, O or U: the suffix is Crockford base32 (`0-9 A-H J K M N P-T V-Z`). Happened 3× (LIVE, RELA, SUPP) — build fixtures from `CROCKFORD` in `@mechdost/shared/ids`.
- ❌ A write that finds its target with the _read_ scope. Scope each action by the grants holding that action's own permission (e.g. `ticketScopeFrom(grants, 'tickets:reply')`).
- ❌ Inline user-facing string (must be in `packages/shared/i18n` en + hi).
- ❌ New content data (product/workshop/service/area/shop/category/template fields) without its Hindi version, or a map/third-party widget that ignores the locale (rule 10, user 2026-11-02). Run `e2e/hindi-coverage.spec.ts`; extend its page list for every new route.
- ❌ `<img>` instead of `next/image`; missing width/height or `sizes`; `priority` on non-hero images.
- ❌ Missing analytics events for new user actions (spec 12).
- ⚠️ More than one primary action per screen, stacked modals, empty state without one next action.
- ⚠️ Not checked at 390 / 768 / 1440 px, with Hindi text, keyboard-only and reduced motion — and not run through
  `e2e/state-matrix.spec.ts` (every role × theme × language × world empty/cart/busy, widths 320–1280;
  `docs/runbooks/ui-testing.md`). The user checks pages by eye in these states; so must we (UI review 2026-11-14).
- ❌ `position: fixed` UI (trays, bars, floating buttons) mounted inside anything animated or transformed, or an
  animation with fill `both`/`forwards` on a wrapper: fixed children then scroll with the page. Mount floating UI in
  the locale layout, outside `template.tsx`.
- ❌ Preferences kept only by a before-paint script or by `next/link` navigation across locales: React clears
  `<html>` attributes when the per-locale root layout changes, and next-intl only syncs `NEXT_LOCALE` on document
  requests. Language switches are full loads that keep query and hash.
- ❌ A header/toolbar row that only fits at the tested widths: check 320–700 px in steps of 10 (both languages).
- ❌ A scroll box inside the page (`max-h` + `overflow-auto`) for main content: it traps scrolling and cuts content.
- ❌ An "every page" client component (layout) that imports a shared module for one constant, or that could load
  on demand: check `measure-js` for every route.
- ❌ UI change planned without naming the states it must be shown in. Before coding, list: the stored keys the
  screen reads, the roles that reach it, every status code of its record (closed ones too), and the worlds to render
  (`docs/runbooks/ui-testing.md`). Minimum: nothing · ongoing order + open ticket + cart · everything · at the limits.
- ❌ A control added without saying what each **other role** sees afterwards (page and count), and in which statuses
  the control is hidden or refused.
- ❌ A test seed written by hand instead of from `e2e/fixtures/demo-world.ts`, or a seeded page with no assertion
  that the seeded record is on screen (2026-11-14: the busy world's ticket had the wrong shape and nothing failed).
- ❌ A third-party widget's background restyled without its text and link colours, or not checked with axe in both
  themes after it has loaded (T61).
- ⚠️ A new stored key or status without a row in the runbook's dimensions table and a world that renders it.
- ⚠️ A state the demo store cannot represent (online payment, refunds, estimate lines, bill, out of stock): say
  where it is tested instead; do not leave it silent.
- ⚠️ A deadline (offer, invite, quote, block, SLA) with no test on both sides of it.
- ⚠️ Demo-only controls ("advance", "demo reply", "demo offer") visible to customers: flag for removal before launch.
- ⚠️ Admin-editable content hard-coded (rule 8).

## Performance & scalability (spec 16, rule 6, 7)

- ❌ Assumes a single city, single shop per order, or single server (in-memory state that must be shared).
- ⚠️ Heavy client library not dynamically imported (maps, charts, scanner); client component where a Server Component works.
- ⚠️ N+1 queries; uncached hot reads; no cache tag invalidation.
- ⚠️ JS budget (L79, L90): anything a client component imports ships on every route that renders it (demo data, translation tables, Zod). Keep server-only data in its own module, import the narrowest module from client paths, keep small islands static (no `next/dynamic` for < 1 KB), and compare `scripts/measure-js.mjs` against the last CI run's budget lines before committing UI work.

## Dependencies & security (research/security-vulnerabilities.md)

- ❌ Version below the security minimums (Next ≥16.4.1, React 19.2.x+, Node ≥22.23.4, Hono ≥4.13.11, Drizzle ≥0.45.4, sharp ≥0.35.4, MapLibre ≥6.4.1, Playwright ≥1.55.1).
- ❌ Package with install scripts not on the `allowBuilds` list; unpinned GitHub Action.
- ⚠️ New package that is unmaintained, very new (<3 days), low-adoption, or duplicates an existing one.

## Docs & process

- [ ] When a decision supersedes an earlier one, grep `CLAUDE.md`, `docs/README.md`, `docs/design-system.md` and the memory files for the old wording and fix them in the same change (promoted from L12 + L39).

- ⚠️ Decision made without a dated entry in `decisions.md` or a ruling in `progress.md`.
- ⚠️ A pending question answered by assumption instead of the documented default.

## Tooling (promoted learnings L10, L11, L18)

- ❌ Shell edits (bash heredocs, Python string replacement) of code that contains backslashes, regexes or quotes — use Write/Edit. Verify with a grep of the exact line afterwards.
- **Hono middleware patterns (L54):** `/x/*` already covers `/x`; never register the same middleware on both. Gate methods with `app.on('POST', '/x/*', …)`. New route files get a test that one request lowers `RateLimit-Remaining` by exactly 1.
- **Commit gates cannot be bypassed by a pipe (T44, L64):** every commit chain starts `set -o pipefail;` then `pnpm check && git add -A && git commit && git push` (`pnpm check` = Prettier + typecheck + lint + tests, one task at a time since 2026-11-11); a gate piped through grep/tail without pipefail reports the filter's success. The pre-commit hook checks formatting; CI checks everything.
- **Invisible characters (L65):** backslash-u escapes written through the Write/Edit tools or a heredoc can land as the real character. Build the backslash with chr(92) in Python, then check: `packages/shared/test/source-hygiene.test.ts` fails on zero-width, BOM, line-separator and NUL characters in tracked source.
- **Demo/API parity (L58):** before calling an API feature done, list the rules the demo store enforces for the same action (standing, blocks, windows, reason codes) and check each one exists in the repository with a test.

## Data for ML (hard rule 16)

- New fields are typed and validated; reasons, statuses and categories are **codes** (enums), free text only as an extra note.
- Every new event has stable ids and foreign keys, UTC timestamps, integer paise and units in the field name, and goes into the typed analytics catalogue (`packages/shared/src/analytics.ts`).
- Analytics stay pseudonymous (no names, phones, addresses); personal data used for offers or training needs per-purpose consent (DPDP).
- New tables and events are documented (`docs/conventions/data-for-ml.md`).

## Promoted 2026-11-15

- ❌ Python-in-heredoc edits that carry escapes or multi-line strings into source files (L104, promoted): use the Edit tool.
- ❌ An email/SMS to an address or number a guest typed (no verification): spam/phishing relay. Only verified account contacts or admin-entered invites.
