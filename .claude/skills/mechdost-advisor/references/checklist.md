# Advisor checklist — red flags per area

Mark each touched item ✅ / ⚠️ / ❌. Anything ❌ blocks implementation until fixed or explicitly ruled.

## Every task

- [ ] Read `docs/progress.md`, `decisions.md`, the spec, and `learnings.md` before acting.
- [ ] The change is in scope of the user's request (no silent widening or narrowing).
- [ ] Docs to update are listed and will change in the same commit (spec, decisions, progress, README index).
- [ ] No user question blocks work: it is queued in `docs/questions-for-user.md` with a default.
- [ ] Commit message has no AI attribution.
- [ ] `pnpm check` (format, typecheck, lint 0 warnings, tests) will be run and its output shown.

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

- [ ] Passwords: never logged or stored by us; one generic error for unknown account / wrong password; per-account lockout; API accepts only `phone` + `custom` tokens; no account creation without a verified phone (decision 2026-11-01).

## Payments (skill razorpay-payments)

- ❌ Amount taken from the client; HMAC over parsed JSON instead of raw body; no amount/currency assert.
- ❌ Refund without remaining-balance check under lock, or without an idempotency key.

## UI / UX (rule 2, design-system.md, ui-ux-pro-max, shadcn skills)

- ❌ New visual language (colours, fonts, radii) not in `design-system.md`.
- ❌ Logging `err.message` / `err.stack` / `String(err)` (database errors embed SQL parameters: phones, message text). Log `safeError(err)` from `apps/api/src/logger.ts` (class, SQLSTATE, frames) plus ids (security review 2026-11-03).
- ❌ A queue/job that retries the same failing item first forever: count attempts outside the rolled-back transaction and park after N.
- ❌ Inline user-facing string (must be in `packages/shared/i18n` en + hi).
- ❌ New content data (product/workshop/service/area/shop/category/template fields) without its Hindi version, or a map/third-party widget that ignores the locale (rule 10, user 2026-11-02). Run `e2e/hindi-coverage.spec.ts`; extend its page list for every new route.
- ❌ `<img>` instead of `next/image`; missing width/height or `sizes`; `priority` on non-hero images.
- ❌ Missing analytics events for new user actions (spec 12).
- ⚠️ More than one primary action per screen, stacked modals, empty state without one next action.
- ⚠️ Not checked at 390 / 768 / 1440 px, with Hindi text, keyboard-only and reduced motion.
- ⚠️ Admin-editable content hard-coded (rule 8).

## Performance & scalability (spec 16, rule 6, 7)

- ❌ Assumes a single city, single shop per order, or single server (in-memory state that must be shared).
- ⚠️ Heavy client library not dynamically imported (maps, charts, scanner); client component where a Server Component works.
- ⚠️ N+1 queries; uncached hot reads; no cache tag invalidation.

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
