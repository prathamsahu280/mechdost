# 22 · Roadside assistance

Status: **phase 1 built 2026-11-24** (manual dispatch) · Phases 2 and 3 not built · Design:
`docs/superpowers/specs/2026-11-24-roadside-assistance-design.md` · Plan: `docs/superpowers/plans/2026-11-24-roadside-assistance.md`
· Decisions: 2026-11-24 "Roadside assistance, phase 1" · Related: 05 (refunds), 06 (arrival code), 10, 12, 14, 15, 17 § D

## Goal

A rider or driver whose vehicle breaks down in a covered PIN code asks MechDost for help from the phone. They pay an
**advance** (default ₹500, set per vehicle type), a nearby verified workshop that opted in is sent the request, comes
to the place, shows the customer's **arrival code**, does the work and enters the bill. The customer pays the **balance
(total minus advance)** online or in cash. Industry complaints designed against: surprise bills, unknown waits, fake
agents.

## Rulings (user, 2026-11-24)

Responder is a mechanic or a workshop (phase 1: workshops); Raipur, requests 24x7, area by PIN code and hours per city,
admin editable; manual dispatch with ranked suggestions now, auto routing later (mode stored per city); price per
vehicle type, admin editable; advance online at booking, balance after the work; no memberships; commission later;
signed in, verified email **not** required; customer cancellation off, admin cancels only while nobody has accepted; the
problem type is optional and "I don't know what's wrong" is a choice. **Vehicle types at launch: 2W and 4W only. 3W is
not offered**; the code set stays 2W/3W/4W and the city setting "vehicle types offered" is the only switch to add it.

## Status machine (`packages/shared/src/state/rsa.ts`)

`awaiting_payment` (row exists, advance not paid; in no queue; closed by the worker after 30 minutes) → `requested`
(advance paid; the dispatch queue) → `offered` (one active offer, accept timer) → `accepted` (responder attached,
arrival code issued) → `en_route` (optional) → `arrived` (customer's code checked, or an audited admin override) →
`in_progress` → `billed` → `completed`. Side exits: `offered/accepted/en_route → requested` (decline, timeout, give up,
admin takes it back), `awaiting_payment → cancelled` (customer or system), `requested/offered → cancelled` (admin only,
refund request for the advance). Not built: `towing`, `no_responder`. Every move is `rsaMachine.assert` plus a
conditional `UPDATE … WHERE id AND status AND version`, an `rsa_events` row and an audit row in one transaction.
Offers have their own machine (`offered → accepted | declined | expired | withdrawn`).

## Data (migration `0082_roadside_assistance`)

`rsa_city_settings` (one row per city, version CAS), `rsa_responders` (workshop opt-in), `rsa_requests` (code
`RSA-{CITY}-{YYYY}-{6 base32}`, vehicle snapshot, `geography(Point)` location, pincode, nullable problem type, note, up to
3 photo paths (upload UI not built), **advance snapshot**, total/balance/overpaid, balance method `online|cash|none`),
`rsa_offers` (partial unique index: one `offered|accepted` per request; `responder_type` = `workshop`, widened for
mechanics later), `rsa_events` (append-only), `rsa_bill_lines` (append-only, `total = qty * unit` CHECK),
`rsa_arrival_codes` (same encrypted 4-digit module as home visits, 5 tries). One live request per customer (partial unique
index). `payments` gained `rsa_request_id` and purposes `rsa_advance` / `rsa_balance` (one open and one captured per
request and purpose); `refunds` gained `rsa_request_id` (exactly one of group, bill, request: CHECK) and sources/reasons
`rsa_cancelled`, `rsa_overpaid`. `notifications.entity_type` accepts `rsa_request`. All new tables: RLS on, grants revoked,
`bump_version` / `touch_updated_at` triggers, listed in `rls-inventory.ts` as `none`.

## Settings (admin, per city, audited; `roadside:settings`)

| Setting                                     | Default                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| enabled                                     | off (a city with no row is off)                                                 |
| vehicle types offered                       | 2W, 4W                                                                          |
| advance per offered type                    | 50000 paise (₹500) each; exactly the offered types (CHECK)                      |
| PIN codes covered                           | none (each must be an active PIN of the city)                                   |
| hours                                       | open all day (or a window in IST, may pass midnight)                            |
| routing mode                                | `manual` (`auto`, `auto_then_manual` stored, not built)                         |
| accept timer                                | 150 s (60 to 900)                                                               |
| bill limit (`maxBillPaise`)                 | 2500000 paise (₹25,000); at most 10000000 (₹1,00,000); a larger bill is refused |
| "Question this bill" (`billDisputeEnabled`) | off; when on, the customer can open a support request about a ready bill        |
| max auto attempts                           | 3 (stored for phase 3)                                                          |
| problem types offered                       | all six                                                                         |
| SOS phone                                   | none (shown to customers outside the area or hours)                             |

Labels and messages are in the `roadside` locale namespace (en and hi).

## Money rules

- The advance is copied from the setting when the request is made. The Razorpay order amount is read from that snapshot
  (never from the client, never from the live setting) and every payment fact is asserted against it. A double click
  returns the same order.
- Balance = max(total − advance, 0). Total below the advance: the difference becomes ONE refund request
  (`rsa_overpaid`); total = advance or lower completes the request with no Razorpay order (`balance_method = none`).
- **Refunds stay approval-first** (decisions 2026-11-15): "automatic" means the system raises the request by itself
  (admin cancel, overpaid advance, late capture), idempotent per payment and reason; finance approves it. Copy never
  promises an instant refund. User ruling 2026-11-24 (Q225): roadside refunds keep the approval step.
- Late capture (the request was cancelled or expired, or a cash mark won first): the payment is recorded, one refund
  request is raised, the request is not resurrected. The request row lock is the arbiter between cash and online.

## API (all under `/v1`; permission in brackets)

Customer: `GET /roadside/availability?pincode=` (public, IP limited), `POST /roadside/requests` (`roadside:request`,
`Idempotency-Key`, 6 per 10 min), `GET /roadside/requests`, `GET /roadside/requests/{code}`, `POST …/pay-advance`,
`POST …/pay-balance` (20 per 10 min), `POST …/cancel` (unpaid only). Payment confirmation uses the existing
`POST /payments/razorpay/verify` and `POST /webhooks/razorpay`.
Admin (`roadside:read` + verified staff, city scoped): `GET /admin/roadside/queue?view=`, `GET …/requests/{code}/suggestions`
(`roadside:dispatch`), `POST …/offer`, `POST …/withdraw`, `POST …/arrival-override` (reason ≥ 5 chars, audited),
`POST …/cancel` (`roadside:cancel`), `GET|PUT /admin/roadside/settings?city=` (`roadside:settings`).
Workshop (`roadside:respond`, scoped to the caller's workshops, 404 otherwise): `GET /workshop/roadside`,
`PUT /workshop/roadside/opt-in/{workshopId}`, `POST /workshop/roadside/requests/{code}/accept|decline|en-route|arrive|start|bill|cash`
(`arrive` 20 per 10 min). Worker: offers past their timer return to the queue and unpaid requests close (every 30 s).

## Ranking

Eligible = published, location verified, approved standing, not busy (paused and suspended workshops are never offered),
same city, opted in, serves the vehicle type, handles the problem (any when none or `unknown`), tows when towing is
needed, inside its own radius (PostGIS `ST_DWithin`), and has not already declined or timed out on this request. Ordered
by distance, then accept rate over the last 90 days (1 until it has offers), then id.

## Notifications (outbox, in the same transaction)

Bell + push (`queueNotice`): customer `rsa.accepted`, `rsa.arrived`, `rsa.bill_ready`, `rsa.refunded` (when the refund is
processed); workshop `rsa.offer`. Texts carry codes and the workshop name only (never the arrival code or an amount).
Cleared when the ask is moot (offer left `offered`, bill left `billed`). Email (7 templates, en and hi: received, accepted with the arrival code, arrived, bill ready, completed, cancelled with the refund asked for, refund processed) and WhatsApp (UTILITY, request code only: accepted, arrived, bill ready, refunded for the customer; new offer for the workshop) go through the outbox in the same transaction. WhatsApp is queued only while staff switched the event on and Meta approved it; the five templates are in the catalogue but not yet submitted (runbook whatsapp-templates § Roadside templates). The arrival code is in the accepted email only.

## Analytics (spec 12)

Server: `rsa_created`, `rsa_fee_paid`, `rsa_offered`, `rsa_accepted`, `rsa_declined`, `rsa_timeout`, `rsa_en_route`,
`rsa_arrived`, `rsa_billed`, `rsa_completed`, `rsa_cancelled`, `rsa_late_capture`, `admin_rsa_settings_saved`,
`workshop_rsa_opt_in_saved`. Client: `rsa_started`, `rsa_location_set {via, inArea}`, `rsa_problem_selected {code|skipped}`,
`rsa_sos {channel}`. Props are ids, codes, enums and integer paise; never the location or the note.

## Web

`/roadside` (request: GPS or PIN code, vehicle types from the settings response, optional problem including "I don't know
what's wrong", note, review, pay the advance), `/roadside/{code}` (steps, responder, arrival code, bill with advance and
balance, refund note, polls every 15 s, no map), Admin → Roadside (queue with ranked suggestions, offer, withdraw, cancel;
settings), a Roadside panel in the workshop portal (opt-in, offers with a countdown, job steps, bill lines, cash). The
browser demo has its own store (`apps/web/src/demo/roadside.ts`) following the same rules, so every page renders without
the API. Entry link on the workshops page.

## Acceptance tests (all built)

`packages/shared/test/rsa.test.ts` (machine, money, hours, contracts), `packages/db/test/roadside.test.ts` (settings, creation
refusals, advance payment, dispatch, double accept, accept vs timeout, cancel and double refund, arrival code lock and
override, bill and balance, cash vs capture, under-advance refund, scope 404s, constraints),
`apps/api/test/roadside.test.ts` (permissions, role leaks, validation, idempotency, webhook, rate limit),
`apps/web/test/roadside.test.ts` (demo flow, messages en/hi, error keys). UI state audit rows `RSA-REQUEST`, `RSA-TRACK`,
`ADM-ROADSIDE`.

## Not built (phase 2 and 3, and gaps)

Auto routing (`auto`, `auto_then_manual`), live map and "last updated N min ago", share status, mechanic accounts and
portal (`responder_type = mechanic`), `towing` status and slabs, customer approval of extra lines, photo upload on the
request, the customer refunds page listing roadside refunds (the tracking page shows them),
GST invoice for the roadside total, customer review after the job, commission and payouts (pending #9), night surcharge.

## Bill safeguards (independent review, user rulings 2026-11-24)

No customer approval of the bill (Q227: no). The workshop enters the lines; the total may not exceed the city's `maxBillPaise`. With `billDisputeEnabled` on, a ready (or completed) bill shows "Question this bill": `POST /roadside/requests/{code}/dispute` opens a support request (kind `rsa_bill_dispute`, `support_tickets.rsa_request_id`, one open per request, 5 per 10 minutes per user); the request view carries `disputeAvailable` and `disputeOpen`, the admin queue `disputed`, and the balance stays payable. A cash balance mark raises the staff notice `staff.rsa_cash` and the event `rsa_cash_marked`. The arrival code override (`POST /admin/roadside/requests/{code}/arrival-override`) works only after the 5-try lock, except for staff who may edit the roadside settings of that request's own city (`roadside:settings` scoped to the city; checked after the row lock, security review 2026-11-24). Before accepting, a workshop sees the pincode, distance, vehicle type, fuel and problem type; the note and address line come with the accepted job. A second captured payment for a request and purpose that is already paid cannot be recorded (unique index): finance gets `staff.refund_alert` once per Razorpay payment. The arrival code is removed from the stored `rsa_accepted` email payload when the mechanic arrives or the email is sent.

## Note 2026-11-24: assistant button on phones

The request form carries `data-launcher-avoid-phone`: under 1024 px the floating "Ask MechDost" button is hidden on this page so it never covers the vehicle cards. Audit row `RSA-FLOAT` (390 px).

## Where it shows (user, 2026-11-24: "really hard to find ... highlight it way more")

Roadside help was a small text link at the bottom of `/workshops`. It is now promoted in six places, **all gated by one
answer: roadside is switched on in the visitor's city** (`publishedRoadside()` in `apps/web/src/lib/site-config-content.ts`;
today the launch city RPR). A city with roadside off shows none of them, so there is never a dead end. Real mode reads the
new public `GET /v1/roadside/city?city=RPR` (`{ enabled, alwaysOpen }`, IP limited like availability, `Cache-Control: public,
max-age=60`; repo `getRsaCityStatus`), cached 60 s by the web server (tag `roadside-city`): no client fetch on any page. A
failed or malformed answer hides the promotion. The browser demo shows it.

1. **Header (from 1024 px):** "Roadside help" with the siren icon, soft accent tile and accent text, after the four
   destinations and before "For business"; labels show from 1440 px like the others, icon only below (accessible name and
   tooltip stay). Current on `/roadside` and `/roadside/{code}`. The four main labels in the header became the short tab
   words (Shop, Workshops, Vehicles): six long labels no longer fit one line at 1440 px.
2. **Tab bar (under 1024 px):** a fifth and last tab "SOS" (Hindi "रोडसाइड"), accent coloured. Five is the maximum; tab labels
   are now one short word each (Workshops, Vehicles) so they stay on one line down to 320 px.
3. **Home:** the section `roadside` ("Stuck on the road?", "A mechanic comes to you in Raipur, 24 hours a day." and one
   primary button "Get roadside help"), first below the hero. It is a normal home section: Admin → Layout can hide or move it
   (`HOME_SECTIONS` in `packages/shared/src/site-layout.ts`; a saved layout without it gets it first). "24 hours a day" is
   shown only while the city's hours are all day; otherwise the line says only the city.
4. **`/workshops`:** a highlighted card at the top (accent border, siren, one outlined link) replaces the old bottom link.
5. **Search:** words that mean a breakdown (roadside, tow, towing, puncture, flat tyre, battery dead, breakdown, stuck, sos,
   jump start and the Hindi and Hinglish forms) put a "Roadside help" suggestion (kind "Service") above the usual rows in the
   header palette, and the same card above the results on `/shop?q=`. Pure matcher
   `packages/shared/src/search/roadside-intent.ts` (whole words, no database; the product search still runs).
6. **Footer:** "Roadside help" under Vehicle care.

Analytics: no new event types. Click ids `nav_roadside`, `tab_roadside`, `home_roadside`, `workshops_roadside`,
`shop_search_roadside`, `footer_roadside` (`data-track`) and `header_search_roadside` (the palette row). Admin: the home
section is controlled in Admin → Layout (label `portal.section_roadside`); the city switch stays in Admin → Roadside.
Tests: `packages/shared/test/roadside-intent.test.ts`, `apps/web/test/roadside-promo.test.ts`, API `GET /roadside/city`; state-audit
rows `CHR-HEADER-ROADSIDE`, `CHR-TABBAR-5`, `CHR-SEARCH-ROADSIDE`, `HOME-ROADSIDE`, `WS-ROADSIDE-CARD` and `/roadside` in the
`NAV-HEADER` / `NAV-TABBAR` walks.

## Note 2026-11-25: who sees what on `/roadside`

Only a customer account gets the request form (unchanged). A guest sees "Sign in with your phone number to ask for roadside help." and a Sign in button (the line "You do not need a verified email." was removed on the user's request; the rule itself, verified email not required, stands). A signed-in staff, shop or workshop account no longer falls into the guest branch: staff see `roadside.staffNotice` ("... You are signed in as staff.") with a link to Admin → Roadside help (the page itself enforces `roadside:*`), shop and workshop accounts see `roadside.partnerNotice` and no link. No Sign in button for any signed-in account. Tests: `apps/web/e2e/search-suggest-close.spec.ts`.
