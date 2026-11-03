# Data for analytics, ML and AI (hard rule 16)

User, 2026-11-01: "everything and every data that we are collecting needs to be in a really good format so it can later be processed for ML and by AI for further upscaling and providing offers."

The goal: any data we collect can later feed recommendations, offers, demand forecasting, fraud/risk scoring, partner scorecards and AI assistants, without cleaning it up first.

## Rules (checked by `mechdost-advisor`; violations block a change)

1. **Typed and validated at the boundary.** Every field has a Zod schema in `packages/shared` and a DB type/CHECK. No "misc" JSON blobs for things we will query; `jsonb` only for genuinely variable payloads, and then with a versioned schema (`schema_version` inside the JSON).
2. **Codes, not free text, for anything we will count or learn from.** Reasons, categories, statuses, decline/cancel/fault reasons and channels use **enum codes** from `packages/shared` (e.g. `ASSIGNMENT_DECLINE_REASONS`: `out_of_stock | too_far | shop_closed | too_busy | price_mismatch | other`). Free text is only an extra "note" next to a code, never instead of one.
3. **Stable identifiers.** UUID v7 primary keys (time-ordered), public codes for humans, and foreign keys everywhere: every event points to the user, order, product, shop, workshop, city and pincode it concerns. Never identify things by name.
4. **Time and money conventions.** `timestamptz` in UTC (display IST), integer paise, basis points for rates, ISO-8601 in JSON, kilometres/metres for distance, explicit units in column names (`*_paise`, `*_bp`, `*_km`, `*_at`).
5. **Append-only facts plus snapshots.** Business events go to append-only `*_events`/ledger tables (orders, coins, partner status, audit). Orders snapshot prices, addresses and product data at the time. History is never overwritten, so models can learn from what actually happened.
6. **One event catalogue.** Product analytics events are typed in `apps/web/src/lib/analytics.ts` / `packages/shared` and documented in `docs/specs/12-analytics-events.md`. Event names are `noun_verb` snake_case with a fixed, versioned property schema. New UI ships with its events (rule 9). No PII in event properties.
7. **Pseudonymous by default.** Analytics and ML datasets use internal ids, never phone numbers, emails, names or addresses. Personal fields live only in operational tables (encrypted where sensitive, spec 13) and are joined only when a person is entitled to see them.
8. **Consent and purpose.** Under the DPDP Act, using personal data for personalised offers or model training needs a recorded purpose and consent (`consents` table: purpose, version, granted/withdrawn at). Data is used only for purposes the person agreed to; withdrawal is honoured in the next training run. Retention periods per table are documented.
9. **Quality signals stored with the data.** Source (`web`/`app`/`admin`/`api`), city, app/version, locale and the actor role are recorded on events, so data can be segmented and bad sources filtered.
10. **Documented.** Each new table or event is added to the data dictionary in its spec (field, type, meaning, allowed values). A dataset nobody can explain is not collected.

## Where this applies today

- Already compliant: orders/coins/partner-status/audit ledgers (append-only, typed, ids, paise); reason codes for shop declines; coin kinds; delivery confirmation method; analytics catalogue.
- To fix as we go: some demo-only stores keep display names (browser demo, replaced by the API); partner pause/suspend reasons are free text, so a `reason_code` enum is added in Phase 1 (research/admin-console.md), with the free text kept as the partner-visible message.

## Later (Phase 3+)

Nightly export of pseudonymised facts to a warehouse (Postgres replica or BigQuery) as partitioned tables; feature tables for recommendations (spec 11) and risk scoring; model cards for anything that affects customers or partners (offers, routing, fraud flags), with a human in the loop for enforcement decisions.
