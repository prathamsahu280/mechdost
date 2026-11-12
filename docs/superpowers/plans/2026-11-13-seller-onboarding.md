# Seller onboarding, invites, agreement and price approval: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real Raipur shops can apply or be invited, are approved by the admin with a delivery area, accept the MechDost agreement, and put products on sale only at admin-approved prices.

**Architecture:**

- **Shared definitions:** GST validators, application DTOs, three state machines, a permission, settings and events live in `packages/shared`.
- **Database:** migration 0038 adds the application fields, invites, price requests, the agreement and the shop's GST status. Repositories own every rule.
- **API:** Hono routes expose the public form, the invite link, the admin queues and the shop's price requests.
- **Website:** the screens run on the demo store (as the partner portals do today), with the same shared validators and codes, so the switch to the API later is a data-source change.

**Tech stack:** TypeScript, Zod, Drizzle and Postgres (PGlite in tests), Hono, Next.js 16, MapLibre (dynamic import), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-seller-onboarding-design.md` (approved by the user, 2026-11-13). Research: `docs/research/compare-gstin-onboarding.md`.

## Global constraints

- **GSTIN pattern:** `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`, with the Luhn mod-36 check character. The state code is 01–38 or 97.
- **"GSTIN or enrolment number":** `gst_status` is `registered` or `enrolled`. Enrolled shops are never routable or used for pricing in this build.
- **Encryption:** the applicant's GSTIN or enrolment number lives only in `partner_applications.kyc_enc`, written with `encryptField`. Duplicates are found with `blindIndex(…, 'gstin')`.
- **Shop status:** approval creates the shop with status `pending`. The shop becomes `approved` only when:
  - the agreement is accepted (if `partners.agreement_required` is on),
  - at least one price is approved, and
  - it has at least one active `shop_pincodes` row.
- **Prices:** a shop's own price change is always a request. `PATCH /v1/shops/{id}/inventory` with `sellingPaise` from a shop role → `409 PRICE_NEEDS_APPROVAL`. Prices set by staff stay direct.
- **One pending request** per shop and variant (partial unique index).
- **Approving or rejecting a request:**
  - Approved: `shop_inventory` is created or updated with that price, `active = true`, `admin_blocked = false`.
  - Rejected: `active = false, admin_blocked = true` with `blocked_reason_code`. Reservations held by open orders stay.
- **Invite token:** 32 random bytes in base64url. Only its SHA-256 is stored. Single use, expires after `partners.invite_days` (default 7). One open invite per phone.
- **Invited sellers:** the email counts as verified through the link; the phone is still confirmed by OTP at first sign-in (Q78).
- **New settings** (`OPERATIONAL_SETTINGS`):
  - `partners.default_shipping_paise` (int, 0–50_000, default 4_000);
  - `partners.default_lead_days` (int, 0–14, default 2);
  - `partners.invite_days` (int, 1–30, default 7);
  - `partners.agreement_required` (boolean, default true).
- **New permission:** `prices:approve`, in `OPS` (so ops_manager, city_manager; super_admin has all).
- **Hard rules:** every string in en + hi; Turnstile and a rate limit on public routes; Zod `.strict()`; 404 for foreign ids; audit and events in the same transaction; codes, not free text.
- **Process:** `pnpm check` before every commit, with no AI attribution. Low-memory machine: e2e with `--workers=1`. The JS budget is 180 KB gz (`/shop` 175.4 today); the map loads only when the dialog opens.

## Review focus

1. **An invite link opened in two tabs, or replayed after submit.** The second submit must be refused (`409 INVITE_USED`) and must never create a second application (Task 3 test "an invite is single use").
2. **A seller asks for a price on a product that was archived after they ticked it, or on a variant whose MRP dropped below the asked price.** Refused with `PRODUCT_NOT_LIVE` / `PRICE_ABOVE_MRP` at submit, and re-checked at approval (Task 3 test "approval re-checks live and MRP").
3. **The admin approves prices for a shop that has not accepted the agreement or has no delivery area.** The prices are stored, but the shop stays `pending` and is never priced or routed (Task 5 test "a pending shop is never priced or routed").
4. **The geolocation permission is denied, or the map fails to load.** The seller can still finish with search or PIN only, the form explains how, and nothing crashes (Task 7 e2e "location without the map").
5. **A rejected change on a product with stock reserved by open orders.** The open orders continue (the reservation is kept); new customers get the next shop (Task 3 test "rejecting a live price keeps open orders").

---

### Task 1: Shared foundations

**Files:**

- Create: `packages/shared/src/gst.ts`, `packages/shared/src/partners.ts`
- Modify:
  - `packages/shared/src/state/index.ts` (three machines);
  - `packages/shared/src/rbac.ts` (`prices:approve` in `PERMISSIONS` and `OPS`);
  - `packages/shared/src/settings.ts` (four settings);
  - `packages/shared/src/analytics.ts` (events);
  - `packages/shared/package.json` (exports `./gst`, `./partners`).
- Test: `packages/shared/test/gst.test.ts`, `packages/shared/test/partners.test.ts`, plus additions to `state.test.ts` and `rbac.test.ts`.

**Interfaces (produces):**

- **`gst.ts`:**
  - `isGstin(v: string): boolean` (pattern + state code + check character);
  - `gstinCheckChar(first14: string): string`;
  - `isGstEnrolmentNumber(v: string): boolean` (12 characters, `^[0-9]{2}[A-Z0-9]{10}$`);
  - `gstinStateCode(v: string): string`.
- **`partners.ts`:**
  - `GST_STATUSES = ['registered','enrolled']`;
  - `LOCATION_SOURCES = ['gps','search','pin']`;
  - `APPLICATION_REJECT_REASONS = ['not_serviceable','documents_invalid','duplicate','not_a_business','other']`;
  - `PRICE_REJECT_REASONS = ['above_market','mrp_mismatch','wrong_product','other']`;
  - `SellerApplicationSchema` (Zod, strict): `name, phone (+91 E.164), email, businessName, shopName, shopNameHi?, gstStatus, gstNumber, addressLine, landmark?, pincode, location {lat,lng,accuracyM,source}, productSlugs (1–500, unique), consent: true`, with a `superRefine` that `gstNumber` matches the chosen status;
  - `InviteSchema` (`name, email, phone`).
- **State machines:**
  - `applicationMachine`: `new→in_review` (admin); `new|in_review→approved|rejected` (admin); `new→approved` (system, for invites).
  - `inviteMachine`: `sent→used` (system); `sent→expired` (system); `sent→revoked` (admin).
  - `priceRequestMachine`: `pending→approved|rejected` (admin); `pending→withdrawn` (shop); `pending→superseded` (system).
- **Events (server):**
  - `partner_application_submitted {kind, source, gstStatus, products, locationSource}`;
  - `partner_application_decided {decision, reasonCode}`;
  - `partner_invite_sent {}`;
  - `price_request_submitted {shopId, sku}`;
  - `price_request_decided {shopId, sku, decision, reasonCode}`;
  - `agreement_accepted {shopId, version}`.
- **Client event ids** use the existing `click` schema: `partner_location_<source>`, `partner_products_opened`.

- [ ] **Step 1:** Write `gst.test.ts`:
  - `isGstin('27AAPFU0939F1ZV')` and `isGstin('22ABVCS4888H1ZL')` are true;
  - changing the last character → false;
  - state code `00` or `39` → false;
  - lower case → false;
  - `gstinCheckChar('27AAPFU0939F1Z') === 'V'`;
  - an enrolment number of 12 characters is valid; 11 characters or symbols are invalid.
- [ ] **Step 2:** Write `partners.test.ts`:
  - a valid seller application parses;
  - `gstStatus: 'registered'` with an enrolment number fails;
  - `productSlugs` empty or duplicated fails;
  - an unknown key fails (strict);
  - `consent: false` fails;
  - the phone is normalised to `+91…`.
- [ ] **Step 3:** Add to the machine tests: the transitions above are allowed for the listed actors; `approved→pending` is illegal; a shop cannot approve its own request. Add to the rbac test: `ops_manager` and `city_manager` have `prices:approve`; `marketing` does not.
- [ ] **Step 4:** Run `pnpm --filter @mechdost/shared exec vitest run`. Expected: the new tests FAIL (modules missing).
- [ ] **Step 5:** Implement the files. The check character is Luhn mod 36 as in the research doc (alphabet `0-9A-Z`, factor 1 at even indexes and 2 at odd ones, add `floor(p/36) + p%36`, check `(36 - sum%36) % 36`).
- [ ] **Step 6:** Run the shared tests. Expected: PASS.
- [ ] **Step 7:** Run `pnpm check`, then commit `feat(shared): GST validators, seller application schema, onboarding state machines`.

### Task 2: Migration 0038 and schema

**Files:**

- Modify: `packages/db/src/schema/platform.ts` (applications, invites, agreements), `packages/db/src/schema/catalogue.ts` (`shops.gst_status`, `shop_inventory.admin_blocked`, `shop_price_requests`).
- Create: `packages/db/drizzle/0038_seller_onboarding.sql` (generated, plus a header and `SET lock_timeout = '5s'`, RLS, revokes, and version/updated_at triggers on the new mutable tables).
- Test: `packages/db/test/seller-onboarding-schema.test.ts`.

**Interfaces (produces):**

- **`partner_applications` gets:**
  - `email citext`, `shop_name`, `shop_name_hi`;
  - `gst_status` (CHECK in `GST_STATUSES`) and `gstin_index`;
  - `address_line`, `landmark`;
  - `location geography`, `location_accuracy_m int ≥ 0`, `location_source` (CHECK);
  - `source` (`public|invite`, default `public`) and `invite_id → partner_invites`.
  - `details` becomes nullable. A seller row needs `gst_status`, `address_line` and `location` (CHECK `kind <> 'seller' or …`).
- **`partner_application_products(application_id, product_id)`:** unique together; both foreign keys indexed.
- **`partner_invites`:**
  - `token_hash unique`, `name`, `email`, `phone`;
  - `created_by → users`, `expires_at`, `used_at`;
  - `status` (CHECK in `INVITE_STATES`), `application_id`, `version`;
  - partial unique `(phone) where status = 'sent'`.
- **`shop_price_requests`:**
  - `shop_id`, `variant_id`;
  - `requested_paise > 0`, `previous_paise`, `on_hand ≥ 0`;
  - `status` (CHECK), `reason_code`, `note`, `decided_by`, `decided_at`;
  - `requested_by`, `version`, `created_at`;
  - partial unique `(shop_id, variant_id) where status = 'pending'`;
  - index `(status, created_at)`.
- **Shops and inventory:** `shop_inventory.admin_blocked boolean default false` and `blocked_reason_code`; `shops.gst_status text not null default 'registered'` (CHECK).
- **`agreement_versions`:** `version int unique`, `text_en`, `text_hi`, `published_at`, `created_by`.
- **`shop_agreements`:** `shop_id`, `version`, `accepted_by`, `accepted_at`; unique `(shop_id, version)`; append-only with `forbid_update_delete`.

- [ ] **Step 1:** Write `seller-onboarding-schema.test.ts` against `createTestDb()`:
  - a second pending request for the same shop and variant fails `23505`;
  - an invalid `gst_status` fails `23514`;
  - a seller application without a location fails `23514`;
  - a second `sent` invite for the same phone fails `23505`;
  - an `UPDATE` on `shop_agreements` throws.
- [ ] **Step 2:** Run `pnpm --filter @mechdost/db exec vitest run test/seller-onboarding-schema.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Edit the schema; `pnpm --filter @mechdost/db exec drizzle-kit generate --name=seller_onboarding`; `node scripts/fix-migrations.mjs`; then add the header, the lock timeout, RLS and triggers by hand.
- [ ] **Step 4:** Run the test. Expected: PASS. Also run `test/catalogue.test.ts` and `test/routing.test.ts` (still PASS).
- [ ] **Step 5:** Run `pnpm check`, commit `feat(db): seller onboarding schema (migration 0038)`, then apply it to the dev database with `pnpm db:migrate` and run the Supabase advisors.

### Task 3: Repositories

**Files:**

- Create:
  - `packages/db/src/repo/partner-applications.ts`;
  - `packages/db/src/repo/partner-invites.ts`;
  - `packages/db/src/repo/price-requests.ts`;
  - `packages/db/src/repo/agreements.ts`.
- Modify: `packages/db/src/repo/index.ts`, `packages/db/src/repo/inventory.ts` (`updateShopInventory`: a shop actor with `sellingPaise` → `ConflictError('…','PRICE_NEEDS_APPROVAL')`).
- Test: `packages/db/test/partner-applications.test.ts`, `packages/db/test/price-requests.test.ts`.

**Interfaces (produces):**

- **`submitSellerApplication(db, input: SellerApplication & {source:'public'} | … & {source:'invite', inviteToken}, keyring) → {code, status}`:**
  - Encrypts `{gstNumber}` into `kyc_enc` and writes `gstin_index`.
  - Maps slugs to live product ids; unknown slugs → `ValidationError('PRODUCTS')`.
  - Invite source: in one transaction, the invite moves `sent→used`, and the application is created `approved` by `system`, recording the inviter as `reviewed_by`. If the GSTIN is a duplicate, it is created `in_review` instead.
- **`listApplications(db, scope, {status?, after?})` / `getApplication(db, scope, code)`:** return a `duplicateGstin: boolean` flag; the GSTIN itself is decrypted only for `applications:review`.
- **`approveApplication(db, {code, version, staffUserId, coverage: {pincode, shippingPaise, leadDays}[]})`:** creates the shop (`pending`, `gst_status`, address, location, city and state from the PIN) and the `shop_pincodes` rows. Returns `{shopId}`.
- **`rejectApplication(db, {code, version, staffUserId, reasonCode, note?})`.**
- **`linkApplicantOwner(db, {userId, phone})`:** called on sign-in. If an approved application's phone matches and has no owner yet, `shop_users` gets an `owner`. Idempotent.
- **Invites:**
  - `createInvite(db, {name,email,phone,staffUserId}) → {token, expiresAt}`: enqueues an outbox `email` notification `partner_invite`.
  - `openInvite(db, token) → {name, email, phoneLast4}`: `NotFound` for an unknown token; `Conflict` `INVITE_USED`, `INVITE_EXPIRED` or `INVITE_REVOKED`.
  - `revokeInvite(db, {id, staffUserId})`.
- **Price requests:**
  - `submitPriceRequest(db, {shopId, userId, sku, pricePaise, onHand}) → {id}`: the product must be live, the price ≤ MRP, the variant ticked in the shop's application or already in its inventory; a previous pending request becomes `superseded`.
  - `withdrawPriceRequest`.
  - `decidePriceRequest(db, {id, version, staffUserId, decision:'approved'|'rejected', reasonCode?})`: approval re-checks live and MRP and upserts `shop_inventory`; rejection blocks the row; then `maybeGoLive`.
  - `listPriceRequests(db, scope, {status})`.
- **Agreements:** `publishAgreement(db, {textEn,textHi,staffUserId}) → {version}`; `currentAgreement(db)`; `acceptAgreement(db, {shopId, userId, version})`, then `maybeGoLive`.
- **`maybeGoLive(tx, shopId)`:** a conditional update `pending → approved` when the agreement is accepted (if required), at least one price is approved, and at least one coverage row is active. Audited; event.

- [ ] **Step 1:** Write `partner-applications.test.ts`:
  - **Public submit:** stores encrypted GST (the raw value is not in the row), the products and the location.
  - **Duplicates:** a second application with the same GSTIN is flagged as a duplicate.
  - **Invites:**
    - an invite is single use (the second submit → `INVITE_USED`, still one application);
    - an expired invite → `INVITE_EXPIRED`;
    - an invited submission is `approved`, unless it is a duplicate GSTIN (→ `in_review`).
  - **Approval:**
    - creates a `pending` shop with the coverage rows;
    - another city's scope gets 404.
  - **Rejection:** needs a reason code.
  - **Owner link:** `linkApplicantOwner` grants the owner once (idempotent).
- [ ] **Step 2:** Write `price-requests.test.ts`:
  - **Submit:**
    - a request above MRP → `PRICE_ABOVE_MRP`;
    - a request for a product that is not live → `PRODUCT_NOT_LIVE`;
    - a second request supersedes the first.
  - **Approval:**
    - puts the product on sale at that price;
    - **re-checks live and MRP**.
  - **Rejection:**
    - a rejected first price leaves no sellable row;
    - **rejecting a live price keeps open orders** (the reservation stays active), and the catalogue offer for that PIN moves to the next shop.
  - **Direct price edits:** a shop's `updateShopInventory` with a price → `PRICE_NEEDS_APPROVAL`; a staff edit is direct.
  - **Going live:** `maybeGoLive` turns the shop `approved` only after the agreement, a price and coverage, in any order.
- [ ] **Step 3:** Run both files. Expected: FAIL (functions missing).
- [ ] **Step 4:** Implement the repositories. Every status change: `machine.assert`, then a conditional UPDATE on `(id, status, version)`, then audit and an event in the same transaction.
- [ ] **Step 5:** Run the two files plus `inventory.test.ts`, `catalogue.test.ts` and `routing.test.ts`. Expected: PASS.
- [ ] **Step 6:** Run `pnpm check`, then commit `feat(db): seller applications, invites, price requests and agreement`.

### Task 3b: Email channel (Resend)

The user gave a Resend key (send-only, in `.env` as `RESEND_API_KEY`); invites are its first use.

**Files:**

- Create: `apps/api/src/notify/email.ts`, `packages/shared/src/email-templates.ts`.
- Modify:
  - `apps/api/src/config.ts` (`RESEND_API_KEY` optional, `^re_[A-Za-z0-9_]{20,}$`; `EMAIL_DOMAIN` default `mechdost.com`, used to build the five senders);
  - `apps/api/src/worker.ts` (add the adapter when configured);
  - `.env.example` (notes);
  - `docs/runbooks/` (a new `email.md`).
- Test: `apps/api/test/email.test.ts`.

**Interfaces (produces):**

- **`createEmailAdapter({apiKey, from, fetch?}): ChannelAdapter`** (channel `email`):
  - `POST https://api.resend.com/emails` with the `Authorization: Bearer` header and an `Idempotency-Key` set to the outbox dedupe key;
  - 10 s timeout, no SDK.
  - Responses: 429/5xx → `ChannelError('retry')`; 401/403 → `'later'`; 422 → `'permanent'`.
- **`EMAIL_PURPOSES = ['updates','billing','support','promotions','system']`** and **`EMAIL_SENDERS`**:
  - `updates` → `MechDost <updates@mechdost.com>`;
  - `billing` → `MechDost Billing <billing@mechdost.com>`;
  - `support` → `MechDost Support <support@mechdost.com>`;
  - `promotions` → `MechDost <promotions@mechdost.com>`;
  - `system` → `MechDost <noreply@mechdost.com>`;
  - reply-to is always `support@mechdost.com` (decision 2026-11-13 "Email sender addresses").
- **`EMAIL_TEMPLATES`:** `partner_invite {name, link, expiresOn}` (purpose `updates`) in en and hi, subject plus text and an HTML body (plain, branded, no tracking pixels). Every template declares its purpose; the adapter picks the sender from it.
  - Templates are code defaults, overridable later through `notification_templates` (rule 8).

**Steps:**

- [ ] **Step 1:** Write `email.test.ts`:
  - a send posts the rendered template with the idempotency key;
  - 429 → retry; 422 → permanent;
  - an unknown template → permanent;
  - each purpose uses its sender (`partner_invite` from `updates@mechdost.com`), and reply-to is `support@mechdost.com`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Without a verified sending domain, Resend only delivers from `onboarding@resend.dev` to the account owner: queue **Q79** (verify `mechdost.com` in Resend: SPF, DKIM, DMARC). Default meanwhile: invites still show the link to the admin.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Run `pnpm check`, then commit `feat(api): email channel through Resend`.

### Task 4: API routes

**Files:**

- Create: `apps/api/src/routes/partner-applications.ts` (public plus invite), `apps/api/src/routes/admin-partners-onboarding.ts`, `apps/api/src/routes/shop-onboarding.ts`.
- Modify:
  - `apps/api/src/app.ts` (register the routes);
  - `apps/api/src/middleware/rate-limit.ts` (`partnerApplyPerIp {limit 5, 3600 s}`, `inviteOpenPerIp {limit 30, 3600 s}`);
  - `apps/api/src/routes/shop-inventory.ts` (map `PRICE_NEEDS_APPROVAL` to 409);
  - `apps/api/src/routes/auth.ts` or the sign-in hook (call `linkApplicantOwner` after sign-in).
- Test: `apps/api/test/partner-onboarding.test.ts`.

**Interfaces (produces), all JSON with Zod `.strict()` bodies:**

- **Public:**
  - `POST /v1/partner-applications` `{application: SellerApplication, turnstileToken}` → 201 `{code}`. Turnstile is required, rate limited per IP and per phone.
  - `GET /v1/partner-invites/{token}` → `{name, email, phoneLast4, expiresAt}`.
  - `POST /v1/partner-invites/{token}/application` `{application, turnstileToken}` → 201 `{code, status}`.
- **Admin:**
  - With `applications:review`: `GET /v1/admin/partner-applications`; `GET …/{code}`.
  - With `partners:approve`: `POST …/{code}/approve {version, coverage[]}`; `POST …/{code}/reject {version, reasonCode, note?}`.
  - With `partners:write`: `POST /v1/admin/partner-invites`; `GET /v1/admin/partner-invites`; `POST …/{id}/revoke`.
  - With `prices:approve`: `GET /v1/admin/price-requests?status=`; `POST …/{id}/decide {version, decision, reasonCode?}`.
  - With `content:write`: `POST /v1/admin/agreements {textEn, textHi}`.
- **Shop** (`inventory:write`, own shop only):
  - `GET /v1/shops/{shopId}/price-requests`;
  - `POST /v1/shops/{shopId}/price-requests {sku, pricePaise, onHand}`;
  - `POST …/{id}/withdraw`;
  - `GET /v1/shops/{shopId}/agreement`;
  - `POST /v1/shops/{shopId}/agreement {version}`.

- [ ] **Step 1:** Write `partner-onboarding.test.ts`:
  - **Public form:**
    - without Turnstile → 400;
    - a bad Turnstile token → 403;
    - the 6th application in an hour → 429.
  - **Invites:**
    - an invite opened by an unknown token → 404;
    - an invited submission → `approved`.
  - **Admin:**
    - `marketing` cannot list applications (403);
    - another city's application → 404;
    - approve with coverage → a shop with PIN rows.
  - **Shop:**
    - submits a price → it appears in the admin queue;
    - shop B cannot see shop A's requests (404);
    - `PATCH` of `sellingPaise` → 409 `PRICE_NEEDS_APPROVAL`.
  - **Going live:** the agreement is accepted, then the shop goes live after one approved price.
- [ ] **Step 2:** Run `pnpm --filter @mechdost/api exec vitest run test/partner-onboarding.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the routes (handlers only parse, call the repo and map errors).
- [ ] **Step 4:** Run the test plus `shop-inventory.test.ts` and `auth.test.ts`. Expected: PASS.
- [ ] **Step 5:** Run `pnpm check`, then commit `feat(api): seller applications, invites, price requests and agreement routes`.

### Task 5: Pricing and routing guards

**Files:**

- Modify: `packages/db/src/repo/catalogue.ts` (`offerLateral` buyable: `s.gst_status = 'registered' and not si.admin_blocked`), `packages/db/src/repo/routing.ts` (eligibility: the same two conditions), `packages/db/src/repo/checkout.ts` (pricing shop: the same).
- Test: `packages/db/test/routing.test.ts` and `packages/db/test/catalogue.test.ts` (additions).

- [ ] **Step 1:** Add tests:
  - **a pending shop is never priced or routed** (approved prices, no agreement yet);
  - an `enrolled` shop with stock is never priced or routed;
  - an `admin_blocked` row is never priced, even if `active` is flipped by hand.
- [ ] **Step 2:** Run them. Expected: FAIL for enrolled and blocked (pending already passes, through `status = 'approved'`).
- [ ] **Step 3:** Add the conditions.
- [ ] **Step 4:** Run the catalogue, routing and checkout tests. Expected: PASS.
- [ ] **Step 5:** Run `pnpm check`, then commit `feat(db): enrolled shops and blocked listings are never priced or routed`.

### Task 6: Location picker and address search

**Files:**

- Create:
  - `apps/web/src/app/api/geo/search/route.ts` (GET `q`, 3–120 characters; Nominatim `search` with `countrycodes=in`, `limit=5`; one upstream call per second, 10 per minute per client, 1-day cache; returns `{results: {label, lat, lng}[]}`);
  - `apps/web/src/components/partners/location-picker.tsx` (button plus dialog);
  - `apps/web/src/components/partners/location-map.tsx` (MapLibre with a draggable marker, loaded with `next/dynamic`, `ssr: false`).
- Modify: `apps/web/src/lib/map-ui.ts` (labels), en/hi `apply` namespace.
- Test: `apps/web/test/geo-search.test.ts` (route handler with a mocked fetch).

**Interfaces (produces):** `<LocationPicker value={Location|null} onChange={(l: Location) => void} />`, where `Location = {lat, lng, accuracyM, source: 'gps'|'search'|'pin'}`. The dialog has:

- "Use my location" (`getCurrentPosition` with `enableHighAccuracy`, timeout 10 s; shows the accuracy; on denial, a message pointing to search);
- a search field plus a Search button (results list → recentres the map);
- a draggable pin (moving it sets `source = 'pin'`);
- "Confirm this location".

- [ ] **Step 1:** Write `geo-search.test.ts`:
  - a short query → 400;
  - results are mapped to `{label, lat, lng}`;
  - upstream failure → 502 with no cache entry;
  - the 11th call in a minute from one client → 429.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the route and the components. The map module is imported only inside the dialog.
- [ ] **Step 4:** Run the test. Expected: PASS. Typecheck and lint the web app.
- [ ] **Step 5:** Commit `feat(web): location picker with map search and use my location`.

### Task 7: Seller application form and invite page (website)

**Files:**

- Modify:
  - `apps/web/src/components/partners/application-form.tsx` (the seller branch: GST block, shop names, address, `LocationPicker`, products picker; garage and mechanic unchanged);
  - `apps/web/src/demo/store.ts` (`DemoApplication`: new optional fields; `isApplication` keeps old rows);
  - en/hi `apply` namespace.
- Create:
  - `apps/web/src/components/partners/product-picker.tsx` (dialog: search box, list grouped by category from `DEMO_PRODUCTS`, tick-boxes, selected count, "Done");
  - `apps/web/src/app/[locale]/partners/invite/[token]/page.tsx` (demo: reads the invite from the demo store; name, email and phone locked; "Invited by MechDost").
  - `apps/web/src/demo/invites.ts` (`createDemoInvite`, `findDemoInvite`, `useDemoInvite`).
- Test: `apps/web/e2e/seller-onboarding.spec.ts`, `apps/web/test/demo-store.test.ts` (an old application without the new fields still loads).

- [ ] **Step 1:** Write the e2e test:
  - **Fill the seller form:** GSTIN `22ABVCS4888H1ZL`, names, address, location by search (mocked `/api/geo/search` via `page.route`), two products → the "Request received" reference.
  - **A wrong GSTIN** shows the error next to the field.
  - **Location without the map:** geolocation denied plus the map blocked → search still confirms a location.
  - **An invite link** shows locked contacts and submits as approved.
  - **`/hi/partners/apply/seller`** shows no English (Hindi coverage list extended).
- [ ] **Step 2:** Build and run `pnpm exec playwright test e2e/seller-onboarding.spec.ts --workers=1`. Expected: FAIL.
- [ ] **Step 3:** Implement. Run the UI skills first: ui-ux-pro-max for form, checkbox-list and map-dialog guidance, then shadcn-component-discovery (dialog/command list), then frontend-design.
- [ ] **Step 4:** Run the e2e test, `hindi-coverage.spec.ts` and the JS budget (`scripts/measure-js.mjs`). Expected: PASS, every page under 180 KB.
- [ ] **Step 5:** Run shadcn-component-review and web-design-guidelines, fix any findings, run `pnpm check`, then commit `feat(web): seller application with GST, products, address and location; invite page`.

### Task 8: Admin and shop screens (website, demo)

**Files:**

- Modify:
  - `apps/web/src/components/portal/admin-console.tsx` (applications card: checklist, duplicate warning, approve with coverage editor pre-filled from `PIN_CENTROIDS` of the city and default charge and days, reject with a reason);
  - `apps/web/src/components/portal/shop-portal.tsx` (agreement card; "Set your prices" list with a per-line status);
  - en/hi `portal` namespace.
- Create:
  - `apps/web/src/components/portal/admin-invites.tsx` (form plus list with copy link);
  - `apps/web/src/components/portal/admin-price-requests.tsx` (queue);
  - `apps/web/src/demo/price-requests.ts` (demo store mirroring `priceRequestMachine`; on approval it updates the demo shop prices used by checkout).
- Test: `apps/web/e2e/seller-onboarding.spec.ts` (continued).

- [ ] **Step 1:** Extend the e2e test:
  - **Admin invites:** the admin creates an invite → it appears with a copy link.
  - **Approval:** the admin approves an application with coverage.
  - **Shop:**
    - the shop sees the agreement and accepts it;
    - it enters two prices (one above MRP → error).
  - **Price queue:**
    - the admin approves one and rejects the other with a reason;
    - the shop sees "On sale" and "Not approved: Above market price".
  - **A later price change waits**, and the old price stays shown in the shop until it is decided.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement (UI skills as in Task 7).
- [ ] **Step 4:** Run this spec, `roles.spec.ts`, `partners-admin.spec.ts` and `hindi-coverage.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Run `pnpm check`, then commit `feat(web): admin invites, application review with delivery area, price approval queue; shop agreement and prices`.

### Task 9: Docs and wrap-up

**Files:** `docs/specs/07-partner-portals.md` (onboarding, price approval, agreement), `08-admin-console.md` (queues), `12-analytics-events.md` (events), `13-rbac-security-abuse.md` (`prices:approve`, limits, `kyc_enc` use), `15-multi-city.md` (scope); `docs/decisions.md` ("GSTIN or enrolment number"; agreement gate); `docs/progress.md`; advisor and testing learnings.

- [ ] **Step 1:** Update the docs.
- [ ] **Step 2:** Run website-testing and verification-before-completion, then a whole-branch review (Fable 5.2).
- [ ] **Step 3:** Run `pnpm check`, then commit `docs: seller onboarding`.
