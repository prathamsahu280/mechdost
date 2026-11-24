# Roadside assistance (design)

Date: 2026-11-24 · Status: **draft, awaiting the user's approval** · Specs: 06 (workshops & service requests), 07 (partner
portals), 10 (notifications), 15 (multi-city, `serviceable_for.rsa`), 17 § D (future modules: roadside) · Related
designs: `2026-11-15-home-service-design.md` (arrival code, visiting mechanic) · Questions: Q216 (answered below) ·
Research: agent report 2026-11-24 (ReadyAssist, GoMechanic Top Assist, CarDekho, ICICI Lombard, CEAT, Tata EV; sources
listed at the end)

## Intent

A rider or driver whose vehicle breaks down in Raipur asks MechDost for help on the spot. A nearby verified mechanic or
workshop comes to them, fixes it there or tows it to a workshop. The customer always knows the price up front, who is
coming, and where they are. Industry complaints we design against: surprise bills, long or unknown waits, and fake
agents.

## Goals / non-goals / anti-goals

- **Goals:** request help in under a minute from a phone; a verified mechanic or workshop on the way fast; advance (default ₹500)
  known before confirming, balance shown after the work; live map of the responder plus WhatsApp updates; arrival code at the
  roadside; extra parts or towing approved line by line; admin can run it fully (hours, area, prices, routing mode).
- **Non-goals (launch):** membership plans or free-call bundles; insurer or carmaker partner API; highway coverage
  outside the city; commercial vehicles (cranes); a native mechanic app; accident support beyond showing 112 / NHAI 1033.
- **Anti-goals:** a price the customer did not see before confirming; an unnamed person arriving; a request that sits
  with nobody responsible for it; hiding that the responder's location is stale.

## User rulings (2026-11-24, in the user's words where quoted)

| #   | Topic                  | Ruling                                                                                                                                                                                                                                                 |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Who responds           | "either a mechanic or a workshop"                                                                                                                                                                                                                      |
| 2   | Area and hours         | Raipur city, requests 24x7; **admin-configurable** (area by pincode, hours per city)                                                                                                                                                                   |
| 3   | Choosing the responder | Admin dispatch with ranked suggestions **and** auto routing; "make it admin configurable" (mode per city)                                                                                                                                              |
| 4   | Price                  | Admin-configurable, **per vehicle type** (2W, 3W, 4W)                                                                                                                                                                                                  |
| 5   | Payment                | **Advance** paid online at booking (default ₹500, admin-configurable per vehicle type); after the work the responder enters the total and the customer pays the balance (total − advance). Ruling 2026-11-24, replaces the earlier "extra booking fee" |
| 6   | Live tracking          | Live map from the start, plus WhatsApp updates                                                                                                                                                                                                         |
| 7   | Memberships            | Not at launch                                                                                                                                                                                                                                          |
| 8   | Commission and payouts | Decide later (pending #9)                                                                                                                                                                                                                              |
| 9   | Account                | Required; a verified email is **not** required (phone sign-in is enough)                                                                                                                                                                               |
| 10  | Cancellation           | Customer cancellation **off** at launch. Admin cancels only when no responder accepts; rules decided later                                                                                                                                             |
| 11  | Problem type           | **Optional**: "what if the customer has no clue", so "I don't know what's wrong" is a choice                                                                                                                                                           |

## Approaches

1. **A new `rsa_requests` entity with its own short state machine, reusing estimate lines, bills, payments, arrival code,
   notifications and the routing ranker (recommended).** Roadside has different timings (minutes, not days), a responder
   that can be a mechanic, live location, and no proposal/slot step. Folding that into `service_requests` would add many
   "if roadside" branches to a machine that is already long.
2. A `service_mode = roadside` on `service_requests` (as home servicing did). Least new code, but the slot proposal,
   workshop-only responder and day-scale timers do not fit; every roadside rule becomes a special case. Dropped.
3. Hand roadside to a partner (ReadyAssist-style) by API. Fast coverage, but no control over price, quality or data, and
   not what the user asked for. Kept as a later option for highways.

## How it works (approach 1)

### Customer

1. **Roadside help** entry (home, header "More", bottom bar under 1024 px via "Services"). Sign-in required (phone code;
   email not needed).
2. **Where are you?** One tap GPS pin (map, draggable) with address/pincode fallback; outside the active area or hours →
   a clear message plus the call / WhatsApp buttons.
3. **Vehicle:** pick a saved vehicle or the type (2W, 3W, 4W); fuel type (EV changes what can be offered: no jump start).
4. **What happened? (optional):** dead battery, flat tyre, out of fuel, small fix on the spot, needs towing, **I don't
   know what's wrong**. Optional note and up to 3 photos.
5. **Review and pay:** shows the **advance** for that vehicle type (default ₹500) and "the mechanic adds the total after
   the work; you pay only what is left after the ₹500". Pays the **advance online** (Razorpay). Paid → request is live.
6. **Tracking page:** status steps, responder's name, photo if any, workshop name and rating, the **arrival code**, the
   live map with ETA once the responder is on the way, "last updated N min ago" if their location stops, SOS (calls
   MechDost support; shows 112) and "share status" (read-only link for a family member, expires when the job ends).
7. **On the spot:** responder enters the arrival code. When the work is done the responder enters the bill lines (work,
   parts, towing); the customer sees the total, the advance already paid, and the **balance = total − advance**, and
   pays the balance online or cash. If the total is below the advance, the difference is refunded automatically to the
   original payment method. Review afterwards.

### Responder (mechanic or workshop)

- **Workshops** opt in from the workshop portal: roadside on/off, radius, vehicle types, which problem types they handle,
  towing yes/no.
- **Mechanics** do not have accounts yet (mechanic role is "later"). Launch needs a **minimal mechanic portal**: approve
  a mechanic application (form exists, `/partners/apply/mechanic`) → mechanic account with phone sign-in, verified
  status, vehicle types, problem types, base location and radius, on-duty toggle. Mechanics may also be linked to a
  workshop.
- Offer arrives by push + WhatsApp + live ping with a **2–3 minute accept timer** (admin setting). Accept → "On my way"
  starts location sharing from the phone browser (every ~10 s while the page is open). Decline or timeout → next in
  auto mode, or back to admin.
- At the vehicle: enter the arrival code, add lines, mark fixed / towed to workshop, take payment (cash or show the
  online link).

### Admin

- **Settings per city (all audited):** active pincodes, hours, routing mode (`manual` / `auto` / `auto_then_manual`),
  accept timer, max auto attempts, **advance amount per vehicle type (default ₹500)**, towing slabs per vehicle type,
  problem types offered, SOS phone, message templates.
- **Queue "Needs dispatch":** ranked responders (on duty, in radius, vehicle and problem type match, distance, accept
  rate, rating); one-click send. In auto mode it fills only when auto routing runs out.
- **Cancel:** only when no responder accepts. Cancelling refunds the advance in full to the original payment method,
  automatically, with a customer message. Other cancellation rules: later (Q pending).
- **Live board:** open requests on a map, SLA timer per request, responder locations, overrides (arrival code override is
  audited), pause or suspend a responder with a reason.

### Statuses (draft)

`requested` (advance paid) → `offered` → `accepted` → `en_route` → `arrived` (code checked) → `in_progress` →
`completed` (job bill paid) · side exits: `no_responder` → `cancelled` (admin, refund) · `towing` as a step between
`in_progress` and `completed` when a tow is approved. Every move is a conditional UPDATE with `version`; one active offer
per request (partial unique index), same as order assignments.

## Data, money, rules

- Money in paise; the advance is **snapshotted** on the request and recorded as a payment against the job bill. The
  bill shows total, "advance paid" and balance due; balance = max(total − advance, 0); a negative difference becomes an
  automatic refund through the refund ledger. GST invoice for the full total at completion.
- Location history of the responder kept only while the request is open, then reduced to start/arrival points (DPDP:
  location is personal data; purpose notice at "On my way" and at request time).
- Phone numbers masked between customer and responder (calls via support at launch).
- Analytics events (spec 12): `rsa_started`, `rsa_location_set`, `rsa_problem_selected {code|unknown}`,
  `rsa_fee_paid`, `rsa_offered`, `rsa_accepted`, `rsa_declined {reason}`, `rsa_timeout`, `rsa_en_route`, `rsa_arrived`,
  `rsa_line_approved`, `rsa_completed`, `rsa_cancelled {reason}`, `rsa_sos`, `rsa_share_opened`.
- English and Hindi for every screen, template and setting label; problem types and reason codes as enums.

## Live map: how and limits

The responder's phone browser sends its position (Geolocation `watchPosition`) to the API, which writes a thin ping to
Firebase Realtime Database (existing live hub); the customer's page subscribes. Limit: phones stop sending from a web
page when the screen locks or the browser is in the background. The page asks the responder to keep it open, and the
customer sees "last updated N min ago" instead of a frozen dot. WhatsApp status messages carry the essentials either
way. A native app later removes the limit.

## Open (decide later, defaults meanwhile)

- Customer cancellation rules and fee (default: none at launch, cancel via support → admin).
- Commission and payouts for responders (pending #9; default: same as services).
- Night surcharge (default: off; setting exists).
- Free towing distance (default: none; slabs from km 0).
- Whether mechanics can belong to more than one workshop (default: one or none).

## Rough phasing inside launch

1. Settings, entity, state machine, customer request + tracking (no map), admin dispatch, advance + balance + refund.
2. Workshop opt-in and offers; minimal mechanic portal and onboarding.
3. Auto routing; live map; share status; SOS.

## Sources

- CEAT / ReadyAssist: https://www.carwale.com/news/ceat-tyres-partners-with-readyassist-for-247-roadside-assistance/
- GoMechanic Top Assist: https://www.autocarpro.in/news/gomechanic-launches-roadside-assistance-service-top-assist-123752
- CarDekho RSA plan: https://www.cardekho.com/services/detail/rsa-&-service-benefits-278.htm
- ICICI Lombard RSA: https://www.icicilombard.com/motor-insurance/car-insurance/what-is-roadside-assistance
- Tata EV RSA: https://ev.tatamotors.com/service/road-side-assistance.html
- RSA scams: https://www.policybazaar.com/motor-insurance/car-insurance/articles/roadside-assistance-risks-and-scams
- NHAI 1033: https://newsonair.gov.in/nhai-to-upgrade-1033-national-highway-helpline-with-advanced-technology/
- DPDP Rules phases: https://yourstory.com/2025/11/digital-personal-data-protection-dpdp-rules-2025-rollout-over-18-months
