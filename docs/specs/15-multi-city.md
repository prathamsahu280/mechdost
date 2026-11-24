# 15 · Multi-city

Status: decided (foundation in Phase 1) · Research: `../research/industry-features.md` §7

## Goal

Launch Raipur only, but make adding Durg/Bhilai, Bilaspur and other states an operations task, not a code change.

## Model

`states`, `cities` (slug, status live|coming_soon|paused, centroid, radius_km, timezone IST, launch_at), `zones` (optional polygons, GeoJSON), `pincodes` (pincode, city_id, zone_id, centroid, serviceable_for {parts_delivery, doorstep_service, pickup_drop, rsa}, cod_allowed), `settings` scoped by city (acceptance timeout, cancel/return windows, COD cap, fees), partner coverage (`shop_pincodes`, workshop radius), staff `city_ids` scope, `waitlist` (pincode, phone, interest) for non-live areas.

## Behaviour

- City selector in header (default Raipur; auto from pincode/GPS; cookie + URL param); storefront content and prices scoped by city; ISR keys include city.
- Serviceability check at address entry: point-in-polygon or pincode lookup; non-live → "Not serviceable yet — notify me" (captures demand analytics).
- Admin: city launch checklist page (anchor shops/workshops count, catalogue coverage, settings, templates), toggle live; all lists filter by city; city_manager role scoped.
- Analytics by city; "shops per pincode" density KPI.

## Launch playbook (admin-driven)

waitlist demand → seed partners → verify docs → catalogue coverage → settings → train partners on timer → soft launch 2–3 pincodes → monitor acceptance/time-to-accept → expand.

## Acceptance tests

Order in a paused city blocked; staff scoped by city cannot see others; pincode import validates; city switch changes prices/offers; an inactive PIN is refused by checkout, nearby workshops, service requests and new shop coverage (built 2026-11-14, see "PIN codes").

## Seller onboarding (2026-11-13)

Invites and applications belong to a city; staff see and decide only their cities' applications, invites and price requests. The delivery area offered at approval is the city's PIN codes; the default charge and days are operational settings. Nothing assumes Raipur: the demo pre-fills from the demo city's PIN list.

## PIN codes (built 2026-11-14)

User 2026-11-14: "do all Raipur PINs but make it admin configurable". Decision entry 2026-11-14 "Service-area PIN codes".

- **Data** (migration 0048): `pincodes` gains `locality_hi` (Hindi area name; `locality` is the English one — both or
  neither, 2–80 characters), `active` (master switch, default true), `inactive_reason` (code:
  `outside_service_area`, `not_launched_yet`, `no_partners`, `operational_pause`, `other`; `PINCODE_INACTIVE_REASONS`
  in `@mechdost/shared/geo`) + optional `inactive_note` (≤ 300; CHECK: active ⇔ no reason and no note),
  `source` (`seed` | `admin`), `free_delivery_min_paise` (spec 03 "Delivery charges") and `version` with its bump
  trigger. The per-service flags `serviceable_parts/doorstep/pickup` stay in the table, unread: `active` decides today.
  Rows are never deleted (orders, shops, workshops and applications reference them).
- **Serviceability:** an inactive PIN is treated like an unknown one — checkout quote / order `PINCODE_NOT_SERVICEABLE`,
  catalogue PIN prices (`pincodeKnown: false`), nearby workshops `PINCODE_UNKNOWN`, new service requests
  `PINCODE_NOT_SERVED`, default shop coverage at approval (active PINs only) and shop approval coverage (`COVERAGE`:
  "Some PIN codes are not served yet"). Existing orders, shop coverage rows and workshops keep working; a shop's or
  workshop's own address may be in an inactive PIN.
- **Admin API** (verified staff, city-scoped like settings: another city is 404):
  - `GET /v1/admin/pincodes?city=RPR` (or `?pincode=492001` = that PIN's city) — `settings:read`: every PIN with area
    en/hi, centroid, active + reason + note, source, free-delivery threshold, active shop coverage count, version.
  - `POST /v1/admin/pincodes` `{city, pincode, lat, lng, areaEn, areaHi, freeDeliveryMinPaise?}` — `cities:manage`
    (super admin, city manager for their city): 409 `PINCODE_EXISTS`; 422 `PINCODE_AREA` (Hindi must be Devanagari),
    `PINCODE_FAR_FROM_CITY` (> 150 km from the city centre); coordinates outside India are refused by Zod (400).
  - `PATCH /v1/admin/pincodes/{pincode}` `{city, version, centroid?, area?{en,hi}, freeDeliveryMinPaise?}` — only the
    given fields; 409 `STALE_PINCODE`.
  - `POST /v1/admin/pincodes/{pincode}/status` `{city, version, active: true}` or `{…, active: false, reason, note?}`;
    switching on needs a centroid (`PINCODE_NO_CENTROID`).
  - Every write: compare-and-set on `version`, `source = 'admin'`, `audit_log` (`pincode.added/updated/deactivated/
activated`, before/after). Client event `admin_pincode_change {action, reasonCode?}`.
- **Public API:** `GET /v1/cities/{city}/pincodes?locale=en|hi` — a live city's active PINs `{pincode, area, lat, lng}`
  (area in the requested language), 60/min per IP, `Cache-Control: public, max-age=300`. Unknown or not-live city 404.
- **Reference data:** `packages/db/seed/raipur-pincodes.json` (sources and choices: `docs/research/raipur-pincodes.md`),
  loaded with `pnpm db:seed:pincodes` (`--dry-run` validates the file only). Idempotent: adds missing PINs (active or
  off with their reason, as the file says), refreshes rows the seed added earlier when names/centroid differ, leaves
  `source = 'admin'` rows alone, never switches an existing PIN on or off, never moves a PIN to another city, never
  deletes; one transaction under an advisory lock; each change audited as `pincode.seeded` (actor `system`). A new
  city is created `coming_soon` (going live stays an admin action).
- **Web (real sign-in):** Admin → Settings → **Service area** (`components/portal/admin-pincodes-api.tsx`, loaded with
  `next/dynamic`; helpers `lib/admin-pincodes-view.ts`, unit-tested): city code, search by PIN or area (either
  language), each PIN with its area, status pill (Active / Off: reason), shops covering it and its free-delivery rule;
  Add a PIN code (primary), Edit (sends only changed fields), Switch off (reason code + note) / Switch on. Strings
  `portal.geo_api_*` (en + hi). The seller approval form (`admin-onboarding-api.tsx`) gets **Fill in all active PIN
  codes of this city** (from `GET /v1/admin/pincodes?pincode=<application PIN>`). Demo builds are unchanged.
- **Tests:** `packages/db/test/pincodes.test.ts`, `apps/api/test/pincodes.test.ts`, `packages/shared/test/geo.test.ts`,
  `apps/web/test/admin-pincodes-view.test.ts`.
- **Not yet:** moving a PIN to another city; per-service serviceability (`serviceable_*`); zones/polygons; a CSV import
  in the console (the seed file is the bulk path); the customer "not serviceable yet — notify me" waitlist UI.

### Review findings (2026-11-14, before merge)

- **Fixed:**
  - 492017 had the city centre as its point; it now uses Raipur Junction station (OSM).
  - The admin PIN routes are now in the middleware-bypass test.
- **Known, not fixed yet:**
  - The first `db:seed:pincodes` run treats the 5 pre-existing PINs as seed-owned. It names them and moves their centres to the researched points (audited), which is accepted.
  - An inactive PIN in workshop search says "unknown PIN".
  - Approving a partner whose own PIN is inactive gives a generic error.
  - Out-of-scope staff can learn which city a PIN belongs to (the data stays 404).
  - The demo seed overwrites admin-edited PIN rows (only if `db:seed:demo` is re-run on live).

## Home servicing per city (2026-11-15)

`service.home_fee_max_paise` (settings registry, global with per-city override, default 50 000 = ₹500, hard DB cap 50 000): the highest visit fee a workshop of that city may set (`FEE_ABOVE_CAP`; also checked at booking, so a lowered cap blocks bookings of a workshop still above it until it lowers its fee). Home listing and booking are city-scoped like workshops (the PIN of the address decides the city; a workshop in another city is `WORKSHOP_OUT_OF_AREA`).

## City values in the admin (built 2026-11-15, admin next tier part 2)

Admin -> Settings gets a city picker (the cities in the staff member's `settings:write` scope). With a city chosen the screen lists only settings that are not `globalOnly`, marks each "Same as all cities" or "Set for this city", saves overrides with `PUT /admin/settings/{key}` (`city`) and removes one with the clear route ("Use the all-cities value"). `GET /admin/settings/cities` feeds the picker. The home layout (`site.home_layout`) can also be set per city: a city with no row inherits the all-cities one. Company details are global (one legal entity). Server event `admin_setting_city_changed { key, action: overridden|reset }` (and `admin_layout_published.scope`).

## Notify me: PIN waitlist (built 2026-11-15, catalogue tier 2 item 7; migration 0068)

- **Table `pincode_waitlist`** (this is the `waitlist` of the data model, built without a phone column): one row per (signed-in customer, PIN), status `waiting|notified|cancelled`, unique (user, PIN), version/updated_at triggers. The PIN need not be in `pincodes` (people ask about places MechDost has not listed). No contact data is copied: the notice goes to the account.
- **Rules:** signed in with `account:write` AND a verified phone or email on the account (`CONTACT_NOT_VERIFIED`, 403); no guest form and no typed email or phone (strict body, `{pincode}` only), so nobody can make MechDost message an address they typed (anti-relay rule). A PIN that is served now (in `pincodes`, active, city live) is refused (409 `ALREADY_SERVICEABLE`). Joining twice is one wait; at most 5 waiting PINs per person (422 `WAITLIST_FULL`, checked under a lock on the user row). Rate limit 20 writes/hour/person.
- **Routes:** `GET/POST /v1/me/pincode-waitlist`, `DELETE /v1/me/pincode-waitlist/{pincode}`; admin `GET /v1/admin/pincode-waitlist` (`cities:manage`, city scoped: city managers see the PINs of their cities, PINs with no city only all-cities staff): per PIN waiting, told, city, area (en/hi), "served now", oldest wait, plus the total. Audit rows `waitlist.joined|left`; events `waitlist_joined|left|notified` (the PIN, never the person's contact).
- **Telling people:** the worker (every 5 minutes, `notifyServedWaitlist`) finds waiting rows whose PIN is now served and, in one transaction per person, marks the row `notified` and writes the bell notice `account.pin_served` (push per their choices; transactional category because they asked for it; en/hi texts under `notify.account_pin_served`). Told once.
- **Web:** a "Tell me when MechDost reaches this PIN code" button under a saved address that is not served (Account -> Addresses and the checkout/booking address picker, lazy-loaded), with the waiting state and "Stop waiting". Admin -> Settings shows the demand table under Service area.
- **Not built:** email or WhatsApp for the "now served" message (needs a template and consent, Q142), a CSV export of the demand, a public "we are coming to your area" page.

## Roadside assistance coverage (2026-11-24, spec 22)

Roadside is covered per city by `rsa_city_settings.pincodes` (each must be an active PIN of that city), not by the reserved `serviceable_*` PIN flags (still unread). A request resolves its city from its PIN code; hours are IST per city; a city with no settings row is off.
