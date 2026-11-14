# Customer account on the API: addresses, vehicles, profile (design, short)

Date: 2026-11-15 · Specs: 01 (auth & accounts), 03 (checkout addresses), 06 (vehicles in booking) · Decisions: "2026-11-15 — Launch features round" item 2

## Intent

With real sign-in, the account screens (`apps/web/src/components/account/account-area.tsx`) still save addresses, vehicles and
profile edits in the browser (`@/demo/session`). They vanish on another device and are invisible to checkout, booking and
support. Launch needs them on the API so a customer's data is theirs everywhere.

## Goals / non-goals / anti-goals

- Goals: CRUD for saved addresses and vehicles, profile name + preferred language edit, used by checkout and the booking
  form as pickers; demo mode keeps working unchanged.
- Non-goals: phone or email change (spec 01 re-verification flow, later); account deletion (support flow, spec 09);
  exact-fitment vehicle catalogue (type-level stays the default, open item in progress.md).
- Anti-goals: a second source of truth (browser copy of server data), saving addresses outside a serviceable PIN silently,
  showing another user's rows (404, actor-scoped).

## Approaches

1. **API CRUD on the existing tables (chosen):** `addresses` and `vehicles` already exist (identity.ts) with version,
   soft delete and one-default partial unique indexes. Routes `/v1/me/addresses`, `/v1/me/vehicles`, `PATCH /v1/me`.
   Cheapest and matches every rule.
2. Store address/vehicle JSON on `users`: no per-row versioning, no FK to `pincodes`, breaks rule 16. Dropped.
3. Keep the browser copy and sync it: two sources of truth, conflict handling. Dropped.

Only one sensible way, so no user question was needed (coordinator ruling, cost if wrong: low).

## Decided

- Addresses: label code (`home|work|garage|other`), contact name/phone (E.164), line1/2, landmark, PIN (must exist in
  `pincodes`; a PIN outside a live city is allowed to save but checkout warns "not delivered here yet"), city/state derived
  from the PIN server-side (never trusted from the client), optional map pin (lat/lng → `location`), default shipping/billing
  (setting a new default clears the old one in one transaction, conditional on version). Max 10 live addresses per user.
- Vehicles: type 2W/3W/4W (`packages/shared/src/vehicles.ts`), fuel, make, model, variant, year, registration (normalised,
  optional), odometer (optional, integer km). Max 10 per user. Registration is personal data: never in analytics.
- Profile: display name (2–60 chars, NFKC), preferred language `en|hi` (used by emails and push, see the notifications
  design). Phone/email shown read-only.
- Every mutation: Zod strict body, `version` CAS (409 on stale), audit_log, typed analytics event without PII
  (`address_saved {label, isDefault}`, `vehicle_saved {type, fuel}`, `profile_updated {fields}`), rate limit per user.
- Web: in API mode the account sections, checkout address step and booking vehicle step read/write the API; demo mode
  untouched. En + hi strings in `packages/shared/i18n`. Empty states with one next action. State-audit model rows for the
  account sections (empty / one / at limit / long Hindi text) at the audit widths.

## Left to the builder

Route file split, picker component reuse, exact error codes (follow existing `ApiError` codes), cursor-free lists (≤ 10 rows).
