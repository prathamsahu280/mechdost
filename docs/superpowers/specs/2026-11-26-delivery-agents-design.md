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
   active jobs, acceptance rate, rating); offer timer (city setting, default **15 min**, founder 2026-11-26) → accept / decline (reason) / expire →
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

Founder ruling 2026-11-26: **no accident insurance and no uniform or dress requirement** (removed from this list).
eShram registration as an aggregator; a lawyer-reviewed agent agreement (independent
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

## Contract (builder, 2026-11-26)

Shared code: machines `packages/shared/src/state/delivery.ts` (`deliveryJobMachine`, `deliveryOfferMachine`,
`agentStatusMachine`) and the order machine in `state/index.ts`; codes and pure rules
`packages/shared/src/delivery/codes.ts` (`@mechdost/shared/delivery/codes`, Zod-free); DTOs
`packages/shared/src/delivery/api.ts` (`@mechdost/shared/delivery/api`); copy `delivery.*` in `i18n/en.json` + `hi.json`.
Deviations from the text above are in `docs/decisions.md` 2026-11-26 "Delivery agents: contract".

### States

- **Order** (sub-order) adds `ready_for_pickup` (after `packed`) and the terminal `returned`. Agent-mode path:
  `packed →(shop) ready_for_pickup →(agent pickup; admin override) out_for_delivery →(agent; admin override)
delivered`. Hand-back: `out_for_delivery →(shop with return code; admin override) ready_for_pickup` (retry with
  another agent) or `returned` (close, refund). Switch to the shop's own delivery: `ready_for_pickup →(shop confirms)
packed`. Staff cancel `ready_for_pickup → cancelled`. Actor `delivery_agent` added.
- **Delivery job:** `needs_agent → offered → accepted → picked_up → delivered`; `offered|accepted → needs_agent`
  (decline, expire, withdraw, give up); `picked_up → failed`; `failed →(admin) picked_up` (retry, same agent) or
  `returning →(shop code) returned`; `needs_agent|offered|accepted → cancelled`. One active job per sub-order.
- **Offer:** `offered → accepted | declined | expired | withdrawn`; `accepted → given_up | withdrawn`.
- **Agent:** `onboarding → active ↔ paused`, `→ suspended`, `→ offboarded` (reason codes, history).

### API routes (all under `/v1`; bodies `.strict()`; DTO names from `delivery/api.ts`)

| Method + path                                                                        | Who (permission)                  | Body → response                                                                                                                         | Limits / notes                                                                                        |
| ------------------------------------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| POST `/delivery-agent-applications`                                                  | public                            | `DeliveryAgentApplySubmit` → `DeliveryAgentApplyReceived`                                                                               | Turnstile; 5/h per IP; 3/day per phone                                                                |
| GET `/delivery-invites/{token}` (43-character token, from the email)                 | public                            | → `AgentInvitePreview`                                                                                                                  | 30/h per IP                                                                                           |
| POST `/me/delivery-invites/accept`                                                   | signed in (phone verified)        | `AgentInviteAccept` (`token` optional: without it, the open invite of the OTP-proven phone — the WhatsApp path) → `AgentInviteAccepted` | phone must equal the invite phone; single use                                                         |
| GET `/agent/me`                                                                      | `deliveries:read`                 | → `AgentProfile`                                                                                                                        |                                                                                                       |
| POST `/agent/me/online`                                                              | `deliveries:respond`              | `AgentOnlineInput` → `AgentProfile`                                                                                                     | active agents only                                                                                    |
| PUT `/agent/me/documents`                                                            | `deliveries:fulfil`               | `AgentDocumentInput` → `AgentProfile`                                                                                                   | 12-digit numbers refused                                                                              |
| POST `/agent/photos`                                                                 | `deliveries:fulfil`               | multipart `file`, `purpose` (pickup, delivery, failure, document), `jobId` for job photos → `AgentPhotoUploaded`                        | 30/10 min; a paused agent only for a parcel already picked up                                         |
| GET `/agent/me/earnings`                                                             | `deliveries:read`                 | → `AgentEarnings` (payouts, note always null, `corrected`, deliveredJobs)                                                               | own rows only                                                                                         |
| GET `/agent/jobs?view=offers\|active\|done`                                          | `deliveries:read`                 | → `AgentJobPage`                                                                                                                        | cursor paging                                                                                         |
| GET `/agent/jobs/{jobId}`                                                            | `deliveries:read`                 | → `AgentJobDetail`                                                                                                                      | 404 unless offered to / held by this agent; reveal audited                                            |
| POST `/agent/offers/{offerId}/accept`                                                | `deliveries:respond`              | `OfferAcceptInput` → `AgentJobDetail`                                                                                                   | 409 when expired/taken                                                                                |
| POST `/agent/offers/{offerId}/decline`                                               | `deliveries:respond`              | `OfferDeclineInput` → 204                                                                                                               |                                                                                                       |
| POST `/agent/jobs/{jobId}/give-up`                                                   | `deliveries:respond`              | `GiveUpInput` → 204                                                                                                                     | accepted only                                                                                         |
| POST `/agent/jobs/{jobId}/pickup`                                                    | `deliveries:fulfil`               | `PickupInput` → `CodeStepResult`                                                                                                        | 20/10 min per user; 5 tries per code                                                                  |
| POST `/agent/jobs/{jobId}/deliver`                                                   | `deliveries:fulfil`               | `DeliverInput` → `CodeStepResult`                                                                                                       | same as pickup; existing delivery-code rules                                                          |
| POST `/agent/jobs/{jobId}/fail`                                                      | `deliveries:fulfil`               | `FailInput` → `AgentJobDetail`                                                                                                          |                                                                                                       |
| GET `/shop/orders` (existing)                                                        | `orders:read`                     | items gain `delivery: ShopOrderDelivery`                                                                                                | pickup code only to the shop                                                                          |
| POST `/shop/orders/{code}/advance` (existing)                                        | `orders:fulfil`                   | `step: 'ready_for_pickup'` added                                                                                                        | agent-mode only; COD refused                                                                          |
| POST `/shop/orders/{code}/return-received`                                           | `orders:fulfil`                   | `ReturnReceivedInput` → 204                                                                                                             | 5 tries                                                                                               |
| POST `/shop/orders/{code}/delivery-switch/{id}/confirm\|decline`                     | `orders:fulfil`                   | `SwitchConfirmInput` / `SwitchDeclineInput`                                                                                             |                                                                                                       |
| GET `/shop/delivery-mode/{shopId}`                                                   | `orders:read`                     | → `ShopDeliveryModeView`                                                                                                                | own shop                                                                                              |
| POST `/shop/delivery-mode/{shopId}/requests`                                         | `orders:fulfil` (owner)           | `ShopModeRequestInput` → row                                                                                                            | one pending per shop                                                                                  |
| POST `/shop/delivery-mode/{shopId}/requests/{id}/withdraw`                           | `orders:fulfil`                   | → 204                                                                                                                                   |                                                                                                       |
| GET `/admin/delivery/agents`                                                         | `delivery_agents:manage`          | → `AdminAgentPage`                                                                                                                      | city-scoped                                                                                           |
| GET `/admin/delivery/agents/{id}`                                                    | `delivery_agents:manage`          | → `AdminAgentDetail`                                                                                                                    |                                                                                                       |
| PATCH `/admin/delivery/agents/{id}`                                                  | `delivery_agents:manage`          | `AgentEditInput`                                                                                                                        |                                                                                                       |
| POST `/admin/delivery/agents/{id}/status`                                            | `delivery_agents:manage`          | `AgentStatusInput`                                                                                                                      | reason required except `active`                                                                       |
| GET `/admin/delivery/agents/{id}/documents/{kind}`                                   | `delivery_agents:manage`          | → `AdminDocumentView`                                                                                                                   | audited view                                                                                          |
| POST `/admin/delivery/agents/{id}/documents/{kind}/verify\|reject`                   | `delivery_agents:manage`          | `DocumentDecisionInput`                                                                                                                 |                                                                                                       |
| GET/POST `/admin/delivery/invites`, POST `/admin/delivery/invites/{id}/revoke`       | `delivery_agents:manage`          | `AgentInviteInput` → `AgentInviteCreated`                                                                                               | email + WhatsApp                                                                                      |
| GET `/admin/delivery/applications?status=`                                           | `delivery_agents:manage`          | → `{ items, nextCursor }` (phone masked)                                                                                                | city-scoped                                                                                           |
| POST `/admin/delivery/applications/{code}/reject`                                    | `delivery_agents:manage`          | `{ reasonCode, note?, version }` (existing application reject reasons)                                                                  |                                                                                                       |
| GET `/admin/delivery/jobs?view=…`                                                    | `delivery_jobs:assign`            | → `AdminJobPage`                                                                                                                        | city-scoped                                                                                           |
| GET `/admin/delivery/jobs/{jobId}`                                                   | `delivery_jobs:assign`            | → `AdminJobDetail` (suggestions)                                                                                                        |                                                                                                       |
| POST `/admin/delivery/jobs/{jobId}/offer`                                            | `delivery_jobs:assign`            | `JobOfferInput`                                                                                                                         | vehicle must carry the load                                                                           |
| POST `/admin/delivery/jobs/{jobId}/withdraw`                                         | `delivery_jobs:assign`            | `JobWithdrawInput`                                                                                                                      |                                                                                                       |
| POST `/admin/delivery/jobs/{jobId}/failure-decision`                                 | `delivery_jobs:assign`            | `FailureDecisionInput`                                                                                                                  | retry limit                                                                                           |
| POST `/admin/delivery/jobs/{jobId}/override/{kind}` (kind: pickup, delivery, return) | `delivery_jobs:assign`            | `JobOverrideInput`                                                                                                                      | audited; the old `/admin/orders/{code}/deliver-override` refuses agent-mode orders (`AGENT_DELIVERY`) |
| POST `/admin/orders/{code}/delivery-switch`                                          | `delivery_jobs:assign`            | `DeliverySwitchInput` → `DeliverySwitchRow`                                                                                             |                                                                                                       |
| GET `/admin/delivery/shop-mode-requests`, POST `…/{id}/approve\|reject`              | `delivery_agents:manage`          | `ShopModeDecisionInput`                                                                                                                 |                                                                                                       |
| PUT `/admin/shops/{shopId}/delivery-mode`                                            | `delivery_agents:manage`          | `ShopModeSetInput`                                                                                                                      | history kept                                                                                          |
| GET `/admin/delivery/kpis?from&to`                                                   | `delivery_jobs:assign`            | → `DeliveryKpis`                                                                                                                        |                                                                                                       |
| POST `/admin/delivery/payouts`                                                       | `delivery_payouts:manage`         | `AgentPayoutInput` → row                                                                                                                | idempotency key; append-only                                                                          |
| POST `/admin/delivery/payouts/{payoutId}/correct`                                    | `delivery_payouts:manage`         | `AgentPayoutReverseInput` → reversing row                                                                                               | one per payment                                                                                       |
| GET `/admin/delivery/payouts?agentId&from&to`                                        | `delivery_payouts:manage`         | → `AgentPayoutPage`                                                                                                                     | city-scoped                                                                                           |
| GET `/admin/delivery/payouts/summary?from&to`                                        | `delivery_payouts:manage`         | → `AgentPayoutSummary` (agentId, name, delivered, paidPaise)                                                                            | IST days, city-scoped                                                                                 |
| GET `/admin/delivery/payouts.csv?agentId&from&to`                                    | `delivery_payouts:manage`         | CSV                                                                                                                                     | export budget (40/h)                                                                                  |
| GET `/admin/delivery/payouts/delivered-count?agentId&from&to`                        | `delivery_payouts:manage`         | → `AgentDeliveredCount`                                                                                                                 | IST days                                                                                              |
| GET `/delivery-photos/{mediaId}/{variant}?e&s`                                       | signed URL only (issued to staff) | image                                                                                                                                   | 600/min per IP                                                                                        |

Code steps: success answers `CodeStepResult` (200); a wrong code 422 `WRONG_CODE` with `details.attemptsLeft`; locked 423
`CODE_LOCKED`. Shop and admin routes under `/shop/orders/*`, `/admin/orders/*`, `/admin/shops/*` reuse those files'
sign-in, limits and verification (no second run).

Customer order view: agent-mode sub-orders gain `delivery: CustomerDeliveryBlock` (first name + vehicle; never the shop
or the agent's phone; `canRate` + `rating`). Rating (founder 2026-11-26): `PUT /v1/me/orders/{code}/delivery-rating`
(signed-in customer, own delivered agent sub-order) `DeliveryRatingInput` → `DeliveryRatingSaved`; 10 per hour per user;
editable 24 h with `version`. Settings: `delivery.*` keys in `OPERATIONAL_SETTINGS` (Admin → Settings → Partners for now).
