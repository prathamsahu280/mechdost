# Customer account on the API — Implementation Plan (native execution)

**Goal:** Saved addresses, vehicles and profile edit read and write the API in real mode; checkout and the booking form offer saved items; demo unchanged.
**Spec:** `docs/superpowers/specs/2026-11-15-account-api-design.md` (binding), specs 01/03/06/12/14.
**No schema change:** `addresses`, `vehicles`, `users.language` already exist; no migration.

## Global constraints

- Db layer imports only Zod-free shared modules (L102): constants in `shared/account.ts`, DTOs in `shared/account-api.ts`.
- Every repo function takes `userId`; a foreign id is `NotFoundError` (404). Mutations are compare-and-set on `version`, write `audit_log` and a server event in the same transaction. Limits (10) enforced under a `users` row lock.
- PIN must exist in `pincodes`; city/state derived from it. Registration and phone never in events or audit `after`.
- Locale strings only under namespace `accountApi` (inserted before `gstStates`, never re-serialised, L100).

## Tasks (each: failing test → implementation → green)

1. Shared: `account.ts` (labels, fuels, limits, registration normaliser, name cleaner), `account-api.ts` (Zod DTOs), exports. Unit test for normalisers.
2. Db repo `account.ts`: addresses list/create/update/setDefault/delete; vehicles list/create/update/delete; events `address_saved`, `address_deleted`, `vehicle_saved`, `vehicle_deleted`, `profile_updated` in `shared/analytics.ts`. PGlite tests: limits, foreign id 404, stale 409, default swap, PIN derivation, duplicate registration, no PII in events.
3. `updateProfile`: name NFKC + 2–60, event `profile_updated`; test.
4. API routes `/v1/me/addresses*`, `/v1/me/vehicles*` (+ tighten `PATCH /v1/me`); API tests: auth, strict bodies, 404/409/422, rate limit, schema match.
5. Web: `lib/account-api.ts`, `account-api-sections.tsx` (addresses, vehicles, profile) used when `AUTH_MODE === 'firebase'` and `DATA_MODE === 'api'`; pickers `SavedAddressPicker` / `SavedVehiclePicker` in checkout and booking form; `accountApi` strings en + hi.
6. State-audit model rows; regenerate `docs/qa/ui-state-checklist.md`.
7. Docs (specs 01/03/06/12, progress, learnings), `website-testing` triage, one `pnpm check`.
