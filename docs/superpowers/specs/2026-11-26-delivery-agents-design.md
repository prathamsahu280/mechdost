# Delivery agents (design, 2026-11-26)

Status: **approved by the founder 2026-11-26** ("yeah just build it man"). Q217. Research: `scratchpad/delivery/research-market-legal.md` (sourced
market, law and risk study) and `scratchpad/delivery/codebase-study.md` (every delivery touch point, file:line) — the
durable findings are copied into `docs/research/delivery-agents.md` with this design.

## Intent and why

Founder (2026-11-26): "by default shops wont really deliver products themselves but instead delivery agents would
deliver the products … give option to people for apply as delivery agent … the admin … invite delivery agents …
they get a link on their mail and whatsapp for sign in … they would get the shops contact and the customers contact
… they would get a pay all this would be configured by the admin … if a shop opts in for delivery themselves then
that shop works for their own delivery." Why: one consistent, trackable delivery experience across many small shops,
shops freed from delivery, and MechDost control of the last mile (proof, timing, customer experience).

## Goals

1. Every shop sub-order is delivered by a **MechDost delivery agent** unless its shop is approved for **self-delivery**.
2. People **apply** to become agents; admin **reviews documents**, **invites** (email + WhatsApp link) and manages them.
3. Agents use a **mobile web portal** (en + hi) to receive jobs, pick up with a photo, deliver with a photo + the
   customer's existing delivery code, and report failed deliveries.
4. Admin **assigns** jobs from ranked suggestions; agents accept within a timer.
5. Full audit trail, ML-ready data, city-scoped, multi-city ready.

## Non-goals (this release)

- Rider pay, payouts, the rate card, cash on delivery by riders — **founder decides later** (slots reserved, see § Money).
- Masked calling (founder: later) — the design keeps a `contactChannel` seam.
- Auto-dispatch / riders choosing open jobs (founder: decide later) — a setting reserved, not built.
- Native app, live GPS map tracking, batching several drops, logistics-partner APIs (Porter etc.) — later phases.
- Old-battery pickup (hazardous-waste rules) — never in this release.

## Anti-goals (failure even if it works)

- A customer's phone/address visible to an agent who is not on that job, or after delivery.
- An agent marking delivered without the customer's code (only the audited admin override remains).
- Aadhaar collected or stored.
- A shop silently opting out of agents without admin seeing it.
- Riders holding cash before the founder sets the cash rules.

## Founder decisions (2026-11-26)

- Documents: **PAN, driving licence, RC** (no Aadhaar).
- Agents state their **vehicle type**; jobs match vehicles that can carry the load.
- **Photo at pickup and at delivery.**
- Masked calling **later**.
- Money, pay, COD, and the dispatch mode: **later** (defaults below are the lead's calls).

## Lead's calls (defaults, each changeable)

1. **Dispatch = admin assigns** from ranked suggestions (online, vehicle fits the load, nearest to the shop, fewest
   active jobs, acceptance rate); offer timer (city setting, default 5 min) → accept / decline (reason) / expire →
   back to admin. Same pattern as shop routing and roadside. A reserved city setting `delivery.dispatch_mode`
   (`admin` only for now; `broadcast` later).
2. **Cash:** agents take **prepaid orders only** (online, or UPI collected by the platform). **COD sub-orders go to a
   self-delivering shop**, else admin decides per order (convert to UPI-at-door link, or the shop delivers). No rider
   cash ledger until the founder rules.
3. **Shop self-delivery:** shop requests in its portal; **admin approves** (with reason, history kept); admin can also
   set it directly or revoke. A self-delivering shop works exactly as today (pack → out for delivery → code).
4. **Failed delivery:** agent marks `failed` with a reason code (customer_unreachable, customer_refused,
   wrong_address, unsafe_location, vehicle_issue, other + note) and a photo; admin chooses **retry** (new job, same or
   another agent) or **return to shop** (stock returns to the shop on hand-back; refund follows spec 05 rules).
5. **Heavy / bulky items:** each product carries a `load class` (light ≤ 20 kg on a two-wheeler / heavy / bulky);
   the sub-order's class is the highest of its lines; only agents whose vehicle allows that class are suggested. None
   available → admin sends it to the shop's own delivery or (later) a logistics partner.
6. **Contact visibility (no masking yet):** before pickup the agent sees the **shop** name, address, phone and the
   customer's **area + PIN only**; after a photo-confirmed pickup, the customer's **name, exact address and phone**;
   after delivered / failed-closed, both are hidden again (history keeps only codes). Every reveal is an audited event.
7. **Customer sees** the agent's first name, vehicle type and a rating later; never the agent's phone (calls go via
   support until masking exists); never the shop (decision 2026-11-22 unchanged).

## Lead's calls after the builder check (2026-11-26)

8. **COD stays with the shop:** until the founder sets the cash rules, every COD sub-order is delivered by its shop
   itself, whatever the shop's mode (today's flow, unchanged). Agents get prepaid sub-orders only. Checkout keeps
   offering COD; no new payment flow (no UPI-at-door link) in this build; routing unchanged.
9. **Per-order delivery mode:** each sub-order stores its mode (`agent|shop`), set from the shop's mode at routing
   (COD → `shop`). Admin may switch an agent-mode sub-order to `shop` (e.g. no vehicle can carry it); the shop sees it
   and confirms; a decline sends it back to admin (reroute or reject + refund, existing paths).
10. **Documents after sign-in:** the public "Apply as a delivery agent" form takes name, phone, city, vehicle type
    only (Turnstile, rate-limited). Admin invites (or invites someone who never applied); the agent signs in with
    phone OTP and uploads PAN, licence, RC (numbers encrypted, photos in the private docs bucket); admin verifies
    before the first offer.
11. **Safe switch-on:** a per-city `delivery.agents_enabled` (default **off**) until the founder confirms the
    compliance items; existing shops migrate as `self`; new shops default to `agents` only in an enabled city.
    The browser demo shows the agent flow.
12. **Load by weight:** the sub-order's load = sum of (quantity × variant `weight_g`); a product's `load_class` is the
    fallback when a weight is missing; vehicle types carry a max load (admin-editable; defaults bike/scooter 20 kg,
    three-wheeler 300 kg, goods vehicle 1,000 kg).
13. **Failed delivery refund (founder accepted the lead's default 2026-11-26):** one free retry, then return to shop.
    Not the customer's fault (wrong address on our side, unsafe location, agent vehicle issue): full refund incl. the
    delivery fee; customer's fault (refused, or unreachable after the retry): refund of the parts only, the delivery
    fee kept; Coins and coupon restored in both. The sub-order closes as `returned` (new reason codes) when the shop
    confirms the hand-back with the agent's return code; the refund then runs through the existing refund paths.

## Approaches considered

- **A. Agent as a "shop-like" partner on the existing shipment row** — reuse `shipments` with an `agent_id`. Cheap,
  but `shipments` has no version, no status CHECK, no one-active rule; pickup/fail/retry don't fit. Rejected.
- **B. A delivery job entity alongside the order (chosen)** — new `delivery_jobs` with its own state machine,
  versioned CAS moves, one active job per sub-order (partial unique index), offers like `order_assignments`; the order
  machine gains a `ready_for_pickup` stage and the delivered transition is driven by the job. Clean audit and
  retries; mirrors roadside (`rsa_*`) which already works.
- **C. Outsource the last mile (Porter / Shiprocket Quick API)** — fastest, no rider management, but no MechDost
  control of riders, cost per drop, and the founder asked for our own agents. Kept as a later fallback lane for heavy
  items.

## The flow

1. Customer pays (prepaid). Admin routes the sub-order to a shop (unchanged).
2. Shop accepts and packs → **"Ready for pickup"** (instead of "out for delivery") for agent-delivered shops. A
   4-digit **pickup code** is issued to the shop (shown in the shop portal).
3. Admin queue "Needs an agent" (with SLA chips) → assign from suggestions → agent gets push + WhatsApp → accepts.
4. Agent at the shop: enters the shop's **pickup code** + takes the **pickup photo** (parcel, and the battery serial
   for batteries) → job `picked_up`; order `out_for_delivery`; the customer's delivery code is issued (unchanged
   path: page + email; WhatsApp without the code).
5. At the customer: the agent enters the **customer's code** + takes the **delivery photo** → job `delivered` and
   order `delivered` in one transaction (existing `verifyDeliveryCode` rules: 5 tries, lock, admin override).
6. Failed → `failed` → admin retry / return to shop (`returned_to_shop` with the shop's code at hand-back).

## Data (ML-ready, rule 3/16)

- `delivery_agents` (user_id, city_id, status `applied|approved|active|paused|suspended|offboarded` with reason and
  history, vehicle_type code, vehicle load classes, online flag + last_online_at, home area point (PostGIS) for ranking,
  documents as **encrypted numbers** + document photos in the **private R2 docs bucket**, verified_by/at, version).
- `delivery_agent_events` (append-only status history, reasons).
- `delivery_jobs` (order_id, agent_id nullable, status, pickup_code_enc, attempts, photos (media ids), failure
  reason code + note, timestamps per step, version) + partial unique "one active job per order".
- `delivery_job_offers` (job, agent, offered_by, expires_at, status, decline reason) like `order_assignments`.
- `delivery_job_events` (append-only, actor `agent|shop|staff|system`).
- `shops.delivery_mode` (`agents|self`) + `shop_delivery_mode_requests` (request → approve/reject, history).
- `products.load_class` (default `light`; staff edit; seeded for truck tyres/batteries/barrels as `heavy`/`bulky`).
- City settings: offer timeout, max concurrent jobs per agent, photo required on/off (default on), dispatch_mode.
- **Reserved, not built:** `delivery_rate_cards`, `agent_payouts`, `agent_cash_ledger` (money decisions pending).
- Order machine: add `ready_for_pickup` between `packed` and `out_for_delivery` (agents mode only); actor
  `delivery_agent` in `order_events` CHECK; failed/returned paths per spec 05.

## Roles, security, privacy (rule 4, spec 13)

- New role `delivery_agent` with `deliveries:*` permissions only (must **not** reuse `orders:*`, because
  `cityScopeFrom` treats any non-shop grant as a staff city scope). Admin staff get `delivery_agents:manage`,
  `delivery_jobs:assign`.
- Actor-scoped repos: an agent sees only jobs offered to / assigned to them (404 otherwise); contact reveal by stage.
- Invite: single-use token bound to the applicant's phone, 72 h expiry, sent by email + a new Meta-approved WhatsApp
  template; sign-in = existing phone OTP; first sign-in links the agent (like `linkApplicantOwner`).
- Rate limits on apply (Turnstile), code entry (existing 20/10 min), photo uploads (media pipeline, EXIF location
  kept only as a server-side check, never shown).
- Documents: PAN/DL/RC numbers encrypted (`*_enc`), photos private, staff view audited, retention: deleted N days
  after offboarding (setting) unless under dispute.
- No Aadhaar anywhere (Zod refuses 12-digit numbers in document fields).

## Admin console (rule 8)

New section **Delivery**: Applications (review documents, verify, approve/reject with reason), Agents (list, status,
vehicle, online, pause/suspend with reason and history, invite), Jobs queue (needs an agent / offered / active /
failed, with timers and suggestions), Shop delivery mode requests, Settings (per city). Everything en + hi.

## Shop portal

"Ready for pickup" step and the pickup code for agent-mode shops; a "Deliver ourselves" request card; self-delivery
shops unchanged.

## Customer

Tracking shows "Picked up by {first name} ({vehicle})", "Out for delivery", the delivery code (unchanged), failed and
retry messages; never the shop, never the agent's phone.

## Agent portal (`/partner/delivery`, mobile first, en + hi)

Online/offline toggle; offers with countdown (accept/decline with reason); job screen (shop details → pickup code +
photo → customer details → delivery code + photo, or failed with reason + photo); history; profile + documents
status; "Earnings" placeholder ("pay details coming soon") until money is decided; SOS = call support.

## Compliance before the first live delivery (founder actions, queued)

Accident insurance for agents; eShram registration as an aggregator; a lawyer-reviewed agent agreement (independent
partner: can decline offers, no fixed shifts); battery/tyre handling procedure (sealed new batteries only, upright and
strapped); check Chhattisgarh's position on private two-wheelers for paid delivery; CA advice on TDS (PAN mandatory)
and GST on the delivery fee.

## Analytics (rule 9)

Server events for every job move, offer, reveal, photo, failure; client events for the portal screens; KPIs: time to
assign, acceptance rate, pickup time, delivery time, failure rate by reason, agent utilisation.

## Testing (website-testing)

Machine unit tests (every allowed/forbidden edge), DB integrity (one active job, CAS, concurrent accepts, order-row
first locking), role-leak matrix (agent A vs B, shop, customer, staff by city), contact reveal by stage, code and photo
rules, failed/retry/return, self-delivery shop path unchanged, e2e for agent portal + admin queue + shop + customer,
Hindi coverage, state-audit rows, JS budget for the new portal.

## Phases

1. **This build:** everything above (applications, admin, invites, portal, admin-assign dispatch, pickup/delivery
   photos + codes, failed/return, shop self-delivery opt-in, load classes, prepaid only).
2. **After founder's money decisions:** rate cards, payouts with TDS, rider cash for COD, earnings screen.
3. **Later:** masked calls, broadcast dispatch, live map, batching, Porter lane for heavy items, native app.

## Left to the builder

Exact table/column names, migration split, UI layout within the design system, offer-timer defaults, ranking
weights, photo compression settings — following the conventions in CLAUDE.md and the codebase study.
