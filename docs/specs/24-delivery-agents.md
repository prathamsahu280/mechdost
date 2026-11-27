# 24 · Delivery agents

Status: **backend built 2026-11-26** (shared contract, migrations 0105 + 0106, repositories, HTTP API, worker jobs; not
applied to any database, not merged). **Web screens are not built** (second agent, from the contract). Design:
`docs/superpowers/specs/2026-11-26-delivery-agents-design.md` (its "Contract" section has the full route table).
Plan: `docs/superpowers/plans/2026-11-26-delivery-agents.md`. Research: `docs/research/delivery-agents.md`.
Decisions: `docs/decisions.md`, the 2026-11-26 entries "Delivery agents: …".

## 1. Purpose

Every prepaid sub-order of a shop in `agents` mode is carried to the customer by a MechDost delivery agent. Shops in
`self` mode deliver as before. Why: one trackable last mile across many small shops, with proof (photo + code).
Founder, 2026-11-26: agents by default, shops may opt in to self-delivery (admin approves), apply + admin invite,
documents PAN + driving licence + RC (no Aadhaar), photo at pickup and delivery, manual payouts for now.

## 2. Roles and permissions

| Who                           | Permissions                                                                                        | Scope                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------- |
| Role `delivery_agent`         | `deliveries:read`, `deliveries:respond`, `deliveries:fulfil` (plus account and ticket basics)      | self: own offers and jobs |
| `ops_manager`, `city_manager` | `delivery_agents:manage`, `delivery_jobs:assign`                                                   | their cities              |
| `finance`                     | `delivery_payouts:manage` (record and read payouts)                                                | their cities              |
| `super_admin`                 | all of the above (ALL)                                                                             | all cities                |
| Shop users                    | existing `orders:read`, `orders:fulfil` (ready for pickup, return code, switch, deliver-ourselves) | own shop                  |
| Customer                      | own order's agent block; rating                                                                    | own orders                |

Agent permissions are their own keys and never `orders:*`. Accepting an invite grants the role; offboarding removes it.

## 3. States

**Delivery job** (`packages/shared/src/state/delivery.ts`, every move a conditional UPDATE on `version`):

`needs_agent → offered → accepted → picked_up → delivered`; `offered|accepted → needs_agent` (decline, expiry,
withdrawal, give-up); `picked_up → failed`; `failed →(admin) picked_up` (retry, same agent) or `returning →(shop with
return code) returned`; `needs_agent|offered|accepted → cancelled`. Terminal: `delivered`, `returned`, `cancelled`.
Active (one per sub-order): `needs_agent, offered, accepted, picked_up, failed, returning`.

**Offer:** `offered → accepted | declined | expired | withdrawn`; `accepted → given_up | withdrawn`.

**Agent:** `onboarding → active ↔ paused`, `→ suspended` (back to `active` by staff), `→ offboarded` (terminal). Staff
set it with a reason code (history in `delivery_agent_events`). `active` means all three documents are verified.

**Order (sub-order) changes** (spec 04): new states `ready_for_pickup` (after `packed`) and `returned` (terminal; the
reason code is the last delivery failure reason); actor `delivery_agent`; column `orders.delivery_mode` (`agent|shop`),
set at routing from the shop's mode (COD → `shop`); `shops.delivery_mode` (`agents|self`, existing shops `self`);
`products.load_class` (`light|heavy|bulky`).

**Shop mode request:** `pending → approved | rejected | withdrawn`. **Switch to the shop:**
`requested → confirmed | declined | withdrawn`. **Invite:** `sent → used | expired | revoked`. **Document:**
`submitted → verified | rejected`.

## 4. Flows

1. **Apply:** public form (name, phone, city, vehicle type only; Turnstile; 5/h per IP, 3/day per phone) → a
   `partner_applications` row of kind `delivery_agent`; staff see it under Delivery → Applications.
2. **Invite:** staff invite (from an application or someone who never applied): phone required, email optional.
   Single-use token bound to the phone, valid `delivery.invite_hours` (72 h), sent by email and WhatsApp.
3. **Join:** the person opens the link, signs in with phone OTP; the OTP phone must equal the invite phone; the agent
   row (`onboarding`) and the role are created.
4. **Documents:** PAN, driving licence, RC: number (normalised, encrypted, blind-indexed; any 12-digit number refused)
   plus a photo. Replacing a document sets it back to `submitted`, takes the agent offline and withdraws open offers.
5. **Verify:** staff open each document (audited view), verify or reject with a reason code. All three verified →
   staff set `active`. Suggestions and accepts need all three verified.
6. **Dispatch:** the shop marks the order `ready_for_pickup` (agent mode only; COD refused): one job `needs_agent`, a
   4-digit **pickup code** for the shop. Staff see ranked suggestions (active, online, documents verified, vehicle
   carries the load, nearest, fewest jobs, acceptance, rating weighted by `delivery.rank_rating_weight_pct`) and offer
   the job to one agent with a timer (`delivery.offer_timeout_min`, 15 min). One open offer per job.
7. **Offer answer:** accept (409 if expired or taken), decline (reason code), or the worker expires it (every 30 s). A
   declined or expired offer returns the job to `needs_agent` and notifies staff. An accepted job can be given up
   (reason) before pickup.
8. **Pickup:** the agent types the shop's pickup code and takes a photo (if `delivery.photos_required`) → job
   `picked_up`, order `out_for_delivery`, the customer's delivery code is issued (unchanged path). 5 tries per code,
   then locked; staff override is audited.
9. **Deliver:** the agent types the customer's delivery code and takes a photo → job `delivered`, order `delivered`
   in one transaction (existing code rules). Staff override audited.
10. **Fail:** the agent reports a reason code (`customer_unreachable, customer_refused, wrong_address,
unsafe_location, vehicle_issue, other` + note for `other`) and a photo → `failed`. Staff decide: **retry** (same
    agent: `failed → picked_up`; other agent: `failed → returning`, the shop types the agent's 4-digit return code →
    order back to `ready_for_pickup`, a new job opens) or **return to shop** (same hand-back, order ends `returned`,
    refund per spec 05). Attempts per sub-order: `delivery.max_attempts` (2 = one free retry).
11. **Switch to the shop:** staff ask the shop to deliver a `ready_for_pickup` order itself; the shop confirms (job
    cancelled, order back to `packed`) or declines (reason; back to staff). One open request per order.
12. **Shop self-delivery request:** a shop asks to deliver itself (or return to agents); staff approve or reject with a
    reason; staff can also set the mode directly; history kept; one pending request per shop.
13. **Ratings:** after `delivered` the customer rates the agent 1–5 with optional reason codes
    (`on_time, polite, careful_with_parcel, late, rude, damaged, other`; `other` needs a note), once per job, editable
    for 24 h (`version`). The agent row keeps a running sum and count. Staff get one alert when the average drops
    below `delivery.low_rating_alert_x10` after `delivery.low_rating_min_count` ratings. The agent sees only their own
    average and count.
14. **Payouts (manual):** staff with `delivery_payouts:manage` record a payment made outside the app: amount (integer
    paise), IST period, method (`upi|bank_transfer|cash|other`), reference, note, idempotency key. Corrections are one
    reversing row per payment. Staff list and CSV; agent's own list (no staff notes or names); a delivered-count
    helper for a period. No rate maths, no transfers.
15. **Pause, suspend, offboard:** see § 5.

## 5. Standing (security review 2026-11-26)

Every agent job action needs agent status `active`, checked in the one shared agent lookup used by all job actions.

| Agent status | Accept / pick up | Deliver, fail                   | Show return code                   | New offers | Other                 |
| ------------ | ---------------- | ------------------------------- | ---------------------------------- | ---------- | --------------------- |
| `active`     | yes              | yes                             | yes                                | yes        |                       |
| `paused`     | no               | yes (parcels already picked up) | yes (while carrying a parcel back) | no         | may resume (end date) |
| `suspended`  | no               | no                              | no                                 | no         | staff take over       |
| `offboarded` | no               | no                              | no                                 | no         | role grant removed    |

On pause, suspend and offboard: open offers are withdrawn, accepted (not picked-up) jobs go back to the admin queue,
and **every job the agent holds** gets an `agent_unavailable` job event and a staff notice
`staff.delivery_agent_unavailable`. Paused agents with an end date resume in the worker.

## 6. Contact reveal by stage

| Job status                     | Agent sees                                              |
| ------------------------------ | ------------------------------------------------------- |
| `offered`, `accepted`          | shop name, address, phone; customer's area and PIN only |
| `picked_up`, `failed`          | the shop and the customer's name, address, phone        |
| `returning`                    | the shop only                                           |
| delivered, returned, cancelled | nothing (codes only)                                    |

Every reveal is an audited job event (`delivery_contact_revealed`). The customer sees the agent's first name and
vehicle type, never the agent's phone and never the shop. Agents never see who rated them.

## 7. Settings (`delivery.*`, Admin → Settings → Partners for now; per city unless noted)

| Key                                  | Default | Meaning                                                          |
| ------------------------------------ | ------- | ---------------------------------------------------------------- |
| `delivery.agents_enabled`            | off     | Agents deliver prepaid orders of `agents` shops in this city     |
| `delivery.offer_timeout_min`         | 15      | Minutes an agent has to accept (1–60)                            |
| `delivery.rank_rating_weight_pct`    | 20      | Weight of the rating in the ranking (0–100)                      |
| `delivery.low_rating_alert_x10`      | 35      | Alert below this average, in tenths of a star (10–50)            |
| `delivery.low_rating_min_count`      | 5       | Ratings needed before the alert can fire                         |
| `delivery.max_active_jobs`           | 3       | Jobs an agent may hold at once (1–10)                            |
| `delivery.photos_required`           | on      | Photo at pickup, delivery and failure                            |
| `delivery.max_attempts`              | 2       | Attempts per sub-order (1–3)                                     |
| `delivery.invite_hours`              | 72      | Invite link validity (24–168)                                    |
| `delivery.document_retention_days`   | 180     | Global. Days documents are kept after offboarding (setting only) |
| `delivery.max_load_bike_kg`          | 20      | Maximum load per vehicle                                         |
| `delivery.max_load_scooter_kg`       | 20      |                                                                  |
| `delivery.max_load_three_wheeler_kg` | 300     |                                                                  |
| `delivery.max_load_goods_vehicle_kg` | 1,000   |                                                                  |

Dispatch mode is a code list (`admin` only), not a setting. Load = sum of quantity × variant weight; a line without a
weight falls back to its product's `load_class` (bike and scooter: light; three-wheeler: light + heavy; goods vehicle:
all).

## 8. Data model (migrations 0105 and 0106, not applied)

| Table                           | Purpose                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `delivery_agents`               | One per person: user, city, status + reason, vehicle, online flag, home point (PostGIS), rating sum/count, version    |
| `delivery_agent_documents`      | One per agent and kind (unique): encrypted number, blind index, status, media id, reviewer                            |
| `delivery_agent_events`         | Append-only status history                                                                                            |
| `delivery_agent_invites`        | Token hash, phone, optional email, expiry, status; one open invite per phone (partial unique)                         |
| `delivery_jobs`                 | One per attempt: status, agent, photos, failure reason, return intent, version; one active per order (partial unique) |
| `delivery_handover_codes`       | Pickup and return codes in their own rows (attempt counter, lock)                                                     |
| `delivery_job_offers`           | One offer of a job to an agent; one open (`offered                                                                    | accepted`) per job (partial unique)                                             |
| `delivery_job_events`           | Append-only timeline (actor agent, shop, staff, system)                                                               |
| `order_delivery_switches`       | Switch-to-shop requests; one open per order                                                                           |
| `shop_delivery_mode_requests`   | Shop mode requests with history; one pending per shop                                                                 |
| `delivery_ratings`              | One per job: stars, reason codes, note, version                                                                       |
| `delivery_agent_payouts` (0106) | Append-only manual payouts: kind `payment                                                                             | reversal`, paise, IST period, method, reference, idem key, `reverses_id` unique |

Other changes: `orders.delivery_mode`, `shops.delivery_mode`, `products.load_class`; order status and actor CHECKs;
`refunds` source and reason `delivery_returned`; media owner kinds `delivery_photo` and `agent_document` (existing
private bucket; staff-only signed URLs at `/v1/delivery-photos/{id}/{variant}`); `partner_applications` kind
`delivery_agent` (city, vehicle type). All new tables have RLS on, no policies (deny all).

## 9. API summary

All under `/v1`; full table with permissions, DTOs and limits in the design doc "Contract" section. Groups: public
apply and invite preview; `/me/delivery-invites/accept`; `/agent/*` (me, online, documents, photos, jobs, offers,
pickup, deliver, fail, give-up, payouts); shop (`/shop/orders/{code}/advance` step `ready_for_pickup`,
`return-received`, delivery-switch confirm/decline, `/shop/delivery-mode/{shopId}` and requests); `/admin/delivery/*`
(agents, documents, invites, applications, jobs, offer, withdraw, failure-decision, overrides, shop-mode-requests, kpis,
payouts, `payouts.csv`, `payouts/delivered-count`); `/admin/orders/{code}/delivery-switch`;
`/admin/shops/{shopId}/delivery-mode`; customer `PUT /me/orders/{code}/delivery-rating`. Routes live in
`apps/api/src/routes/delivery.ts` and `payouts.ts`.

## 10. Notifications

Notice kinds: agent (`delivery.offer`, `delivery.job_withdrawn`, `delivery.retry`, `delivery.return_to_shop`,
`delivery.document_decided`, `delivery.status_changed`); shop (`shop.delivery_agent_assigned`,
`shop.delivery_switch`, `shop.delivery_returning`, `shop.delivery_mode_decided`); customer (`order.picked_up`,
`order.delivery_failed`, `order.returned`); staff (`staff.delivery_agent_application`, `staff.delivery_documents`,
`staff.delivery_needs_agent`, `staff.delivery_offer_expired`, `staff.delivery_declined`, `staff.delivery_failed`,
`staff.delivery_switch_declined`, `staff.shop_delivery_mode_request`, `staff.delivery_agent_unavailable`,
`staff.delivery_low_rating`). Email templates `delivery_agent_invite`, `delivery_offer`. WhatsApp templates
`delivery.agent_invite`, `delivery.offer`: **not submitted to Meta** (needs the founder's go-ahead; Meta names
`partner_delivery_invite`, `partner_delivery_offer`). The WhatsApp invite carries **no token** (lock screens, chat
backups): it sends the person to the join page, where signing in with the same OTP-proven phone finds the open invite.
The email carries the link. Details: spec 10.

## 11. Analytics

Server events `delivery_*`, `shop_delivery_mode_*` and `order_fulfilment_step` with step `ready_for_pickup`: spec 12.
KPIs (time to assign, acceptance rate, pickup and delivery time, failure rate by reason, utilisation) come from these
and `delivery_job_events`.

## 12. Worker

Offers expire every 30 s (one transaction each; a failure is logged and skipped). Paused agents with an end date
resume. Each expiry writes the offer `expired`, the job back to `needs_agent` (when still `offered`), a job event,
an `audit_log` row `delivery_job.offer_expired` (actor `system`; added 2026-11-27, DC-B11), the staff notice
`staff.delivery_offer_expired` and the server event. The sweep returns how many offers were due; the worker logs
`delivery_offers_not_expired` (warn) when due offers neither expired nor failed, so a stuck sweep is never silent.

## 13. Refund on return

Source and reason code `delivery_returned`. Customer's fault (refused, or unreachable again on the retry): parts only,
`shipping_paise` kept. Otherwise full. Coins and coupon restored. Stock goes back to the shop on hand-back. Spec 05.

## 14. Acceptance tests

- `packages/shared/test/delivery.test.ts`: machines (every allowed and forbidden edge), codes, load rules, refund kind,
  document number rules, contact stage.
- `packages/db/test/delivery-agents.test.ts`: onboarding, who delivers, dispatch and agent flow, failed delivery,
  switch, shop mode, ratings, "security review 2026-11-26" block (standing, documents, pause, offboard), database
  rules (append-only, CHECKs).
- `packages/db/test/delivery-payouts.test.ts`: once per key, reversal only, city scope and agent view, delivered count.
- `packages/db/test/delivery-offer-expiry.test.ts` (DC-B11): an offer through the real path, past `expires_at`, is
  expired by the sweep twice in a row (no failure, job `needs_agent`, audit row, job event, staff notice).
- `apps/api/test/delivery.test.ts`: public apply (human check, per-phone limit), role-leak matrix (anonymous, customer,
  agent A vs B, staff by city, finance vs ops, shop), rate-limit decrement by exactly 1.

## 15. Not built

- Web screens (agent portal, admin Delivery section, shop and customer changes): second agent, from the contract.
- Demo store for the browser demo.
- Masked calling, broadcast dispatch, live map, batching.
- Rider cash and COD (COD stays with the shop).
- Automatic payouts, rate cards, TDS.
- Submitting the two WhatsApp templates to Meta.
- Document retention purge job (the setting exists; no job deletes anything).
- Reroute to another shop after a shop declines a switch (staff cancel with refund, or assign an agent).

## 16. Web contract gaps answered (backend, 2026-11-27)

The web stream listed gaps G1–G8 (its branch, § Web screens). Backend answers, following the web's paths where reasonable:

- **G1** Email invite button → `/partners/delivery-invite/{token}`. The WhatsApp invite has no link (token-free; the
  join page finds the invite by the OTP-proven phone).
- **G2** `ShopOrder` carries `deliveryMode?` and `delivery?: ShopOrderDelivery | null`; `TrackedOrder` (customer order)
  carries `delivery?: CustomerDeliveryBlock | null`. Both blocks live in `@mechdost/shared/delivery/views` (small
  module; re-exported from `delivery/api`).
- **G3** `ApplicationStatusDto.kind` accepts `delivery_agent`. `GET /admin/delivery/applications` rows carry `code,
name, cityCode, vehicleType, status, reasonCode, createdAt` (phone masked).
- **G4** `GET /admin/delivery/jobs?view=all&orderCode=MD-…-N` lists the jobs of one sub-order (`cursor` is an alias of
  `before`).
- **G5** `PUT /me/orders/{code}/delivery-rating`; `GET /agent/me/earnings` → `AgentEarnings`; `GET|POST
/admin/delivery/payouts`; `POST /admin/delivery/payouts/{id}/correct` (`{ note }`, key optional);
  `GET /admin/delivery/payouts/summary?from&to` → `AgentPayoutSummary`. Rows carry `corrected`. Agent profile fields
  are `ratingAvgX10` (average × 10, integer) and `ratingCount`, not `ratingAvg`.
- **G6** Typed client events `delivery_*` in `packages/shared/src/delivery/client-events.ts` (merged into
  `CLIENT_EVENT_SCHEMAS`; codes and booleans only).
- **G7** `AdminJobDetail` has `pickupLocked`, `deliveryLocked`, `retryAllowed`.
- **G8** Not built: the help button stays the company support number. A per-city editable phone needs a text setting
  (the operational settings registry is integer/boolean only); queued as Q-DA5.

**Differences left for the web side — resolved (web alignment, 2026-11-27):**

- Job override: the web posts `/admin/delivery/jobs/{jobId}/override/{kind}`. ✅
- Application reject: the web posts `/admin/delivery/applications/{code}/reject` with `{ reasonCode, note?, version }`,
  `version` from the list row (the demo applications carry a version too). ✅
- Record payout: `idempotencyKey` is a uuid made when the form opens, kept across retries of the same submission and
  renewed after success (`newPayoutKey` / `nextPayoutKey`, `lib/delivery/view.ts`); the demo store records a key
  once. **Note:** the schema's `IdemKey` is `[A-Za-z0-9_-]{16,64}` (16–64, not 8–64 as written above); a uuid fits
  both. "Paid some other way" needs a note (`AgentPayoutInput` refine) — the form says so. Correction: `{ note }`. ✅
- Earnings and payouts: the web types and parses them with `AgentEarnings`, `AgentPayoutPage` (`kind`,
  `corrected`, `totalPaise`, `recordedByName`) and `AgentPayoutSummary`; the agent's own rows have `note: null`. ✅
- Agent rating: `ratingAvgX10` ÷ 10 for display (`ratingFromX10`) + `ratingCount`, on profile, agent rows, detail
  and job suggestions; the rating reasons are the shared `DELIVERY_RATING_REASONS` (`careful_with_parcel`). ✅
- Paging: `agents()` and `invites()` send no cursor; the other lists may. ✅
- G1 copy: the staff "invite sent" line says the email has the link and the WhatsApp message has none. ✅
- G2/G3/G4/G7: the shop card reads `ShopOrder.deliveryMode` / `delivery`, the customer page `TrackedOrder.delivery`
  (rating edits send `version`), the status lookup the shared `delivery_agent` kind, the admin order timeline
  `GET /admin/delivery/jobs?view=all&orderCode=`, and the job detail `pickupLocked` / `deliveryLocked` /
  `retryAllowed` (now required). ✅
- G6: the delivery screens send the 16 typed `delivery_*` events (below). ✅
- Still open: the delivery-application list rows have no shared schema (`api-clients.ts` checks them with a guard
  that requires `version`); the API's customer block has no refund kind, so a returned parcel is worded generally
  ("the amount is shown under Refunds") unless the demo knows full / parts only; the browser demo's order codes have no
  sub-order suffix (`MD-RPR-2026-XXXXXX`, the contract's `OrderCode` wants `…-N`), so the demo store's views parse
  with the shared schemas only for suffixed codes (`demo-delivery.test.ts` happy path uses one).

# Spec 24 — Delivery agents

Design: `docs/superpowers/specs/2026-11-26-delivery-agents-design.md` (approved, Lead's calls 1–13, contract and route
table). The backend sections (data, machines, API, worker, notifications) are written by the backend stream; this
file's **Web screens** section is the web stream's (branch worktree-agent-a36d3c6ca1dc56788, 2026-11-27). Merge both.

## Web screens (web stream, 2026-11-27)

One set of screens serves both builds through a client seam: `apps/web/src/lib/delivery/types.ts` (interfaces, types
from the contract DTOs with type-only imports), `lib/delivery/api-clients.ts` (real sign-in: the route table, every
answer checked with the shared schemas; loaded with `import()` so Zod never reaches a page's first load) and
`demo/delivery-clients.ts` on the browser demo store `demo/delivery-store.ts`. `lib/delivery/use-delivery-client.ts`
picks one; demo screens reload on every demo change, API screens poll (offers 10 s, lists 15–20 s).

### Public

- **Apply as a delivery agent** — `/partners/apply/delivery_agent`: name, mobile, city (Raipur for now), vehicle
  (native radios), consent; Turnstile + `POST /v1/delivery-agent-applications` in real builds. No documents on this
  form (Lead's call 10). Confirmation with the `PA-…` reference and a link to the status page.
- **Partners page** card "Deliver with MechDost" and a footer link. No pay, insurance or uniform words anywhere
  (founder ruling 2026-11-26).
- **Status lookup** (`/partners/status`) recognises delivery-agent references (the shared status kind includes
  `delivery_agent`, G3).
- **Invite** — `/partners/delivery-invite/{token}` (noindex, no referrer; token redacted in analytics and in the
  access log): shows name, city, vehicle, the last 4 digits of the invited mobile number and the expiry; signed out →
  sign in (phone OTP) and come back; signed in → **Accept invite** → "Upload documents".

### Agent portal — `/partner/delivery` (role `delivery_agent`, mobile first, en + hi)

Frame in the layout (stays mounted between tabs): navy status strip with the agent's first name and vehicle, a
**Help** call button (MechDost support), the **Take new jobs** switch (online/offline; only for `active` agents, else
the onboarding/paused/suspended reason in words), and a 4-tab bar (Offers · My jobs · History · Profile; links with
`aria-current`).

- **Offers**: each open offer with a ticking `m:ss` countdown (warning colour under a minute), order code, pickup
  area, drop PIN, items, load class, distance, attempt; **Accept** (primary) opens the job; **Decline** asks for a
  reason (native radios; `other` needs a note). Empty states: "Go online" or "the next one comes here".
- **Job** (`/partner/delivery/jobs/{jobId}`) in 4 steps with "Step n of 4": (1) go to the shop — shop name, area +
  PIN, **Call the shop**, **Open in maps**, what to collect, customer area + PIN only, **I'm at the shop**; (2) the
  shop's 4-digit pickup code + parcel photo (camera, shrunk and re-encoded on the phone: no EXIF) → **Confirm
  pickup**; (3) the customer's name, address and phone appear (call + maps), **I'm at the customer**; (4) the
  customer's delivery code + handover photo → **Delivered**. Codes are sent by themselves at 4 digits; a wrong code
  says the tries left; 5 wrong tries lock it (MechDost support takes over). **Couldn't deliver** (steps 3–4): reason +
  photo → "MechDost tells you what to do next". **I can't do this job** (before pickup): reason. Returning: the
  agent's 4-digit **return code** to tell the shop. A job never offered to this agent: "This job is not available to
  you" (404). Finished jobs show codes only.
- **My jobs** (accepted, picked up, failed, returning) and **History** (delivered, returned, cancelled).
- **Profile**: status, vehicle (changed by MechDost only), own rating average (founder ruling: average only), the
  three documents (PAN card, driving licence, vehicle RC: number + photo, status, rejection reason; Aadhaar refused),
  and **Earnings**: the agent's payouts as recorded by MechDost (date, period, amount, method, reference; a correction
  shows as a minus line) and the delivered-jobs count (founder ruling 2026-11-26: manual payouts).

### Shop portal (agent-mode shops; self-delivery shops unchanged)

On an agent-delivered order from **Packed**: **Mark ready for pickup** (instead of "Out for delivery") → "Finding a
delivery partner" with the **pickup code** (big digits, "tell it only at handover"); when accepted "{first name}
({vehicle}) is coming to pick it up"; after pickup "Picked up by …"; **Parcel coming back** with the agent's return
code entry; MechDost's **"Can you deliver this order yourself?"** with Yes / We can't (reason). A **Who delivers your
orders** card: the mode in words, one request at a time to change it (owner only; reason codes), withdraw, earlier
requests with their outcome.

### Customer order page

For an agent-delivered part: "Finding a delivery partner" → "{name} will pick up your order" → "Picked up by {name}
({vehicle})" + the existing delivery code and "give it only when the parcel is in your hands" → delivered; a failed
try with its reason; "Returned, refund on its way" with the refund wording of Lead's call 13 (full, or parts only
when refused / unreachable again; Coins and coupon restored). Never the shop, never the agent's phone. After
delivery: **Rate your delivery** (1–5 stars as native radios, quick reasons: on time, polite, careful with the parcel,
late, rude, parcel damaged, other + note), editable for 24 h (founder ruling 2026-11-26).

### Admin → Delivery (`/admin/delivery`, Operations group; demo and API)

Tabs: **Jobs** (queues Needs an agent / Offered / On the road / Failed / Coming back / Done; table with order, shop,
PIN, agent, load, waiting minutes + a Late chip from 15 min, offer countdown; **Open** shows ranked suggestions —
vehicle fits the load first, then fewest active jobs, then distance; accept rate — with **Offer to {name}**, take
back (reason), failure decision (retry same agent / another agent / send back to the shop; retry limit), audited
overrides when a code is locked (reason ≥ 5 characters), "Ask the shop to deliver" (reason), and the job timeline:
events, offers, photos). **Applications** (invite → the one-time link shown once with copy; reject with the partner
reasons; invite someone who did not apply; invites list with revoke). **Agents** (status filter; name, masked phone,
vehicle, status, online, active jobs, documents verified, rating average + count; detail: 30-day numbers, documents
with an audited **View**, verify / not accepted with a reason, status change with reason + note and history, vehicle).
**Payouts** (record: agent, amount in ₹ → paise, period, method UPI / bank transfer / cash / other, reference/UTR,
note; filters by agent and period; delivered jobs and amount paid per agent for the period; **Correct this payout**
adds a reversing entry; CSV download). **Shop requests** (approve / reject with a reason). **Settings** (demo: the
city's switch, timer, limits, photos, attempts, vehicle loads; real builds: Admin → Settings → Partners, per city).
The admin order card shows the delivery timeline of an agent-delivered order.

### Browser demo

Logins (password `Raipur@2026`): agent **Sunil Yadav 9000000005** (motorcycle), agent **Deepak Sahu 9000000007**
(three-wheeler, offline), shop **Gupta Lubes & Spares 9000000006** (the agent-mode shop). Agents are on in the demo
city; existing shops deliver themselves. The demo has no payments, so its orders count as prepaid for the delivery
mode (decision 2026-11-27). Photos are never stored in the browser (a flag only).

### Analytics (client, `click` ids; spec 12)

`agent_screen_{offers|jobs|history|profile|job}`, `agent_go_online|offline`, `agent_help_call`,
`agent_offer_accepted|accept_failed|declined`, `agent_at_shop|customer`, `agent_photo_{pickup|delivery|failure|document}`,
`agent_pickup_code_ok|wrong`, `agent_delivery_code_ok|wrong`, `agent_picked_up`, `agent_delivered`,
`agent_delivery_failed`, `agent_job_given_up`, `agent_call_shop|customer`, `agent_map_shop|customer`,
`agent_document_saved_{kind}|refused_{kind}`, `agent_invite_accepted|accept_failed`,
`partner_application_delivery_agent`, `shop_ready_for_pickup(_failed)`, `shop_return_code_ok|wrong`,
`shop_switch_confirmed|declined`, `shop_mode_request_{self|agents}|withdrawn`, `delivery_rated|rate_failed`,
`admin_delivery_tab_{tab}`, `admin_delivery_offered|withdrawn|retry_same|retry_other|return_to_shop|switch_to_shop`,
`admin_delivery_override_{kind}`, `admin_delivery_invited(_direct)|invite_failed|invite_revoked|application_rejected`,
`admin_agent_status_{status}|vehicle_saved|document_viewed_{kind}|document_verified_{kind}|document_rejected_{kind}`,
`admin_shop_mode_approved|rejected`, `admin_delivery_settings_saved`, `admin_delivery_payouts_viewed|payouts_csv|
payout_recorded|payout_corrected` (+ `_failed` variants), and `code_submitted {kind:'delivery'}` for every code.
**Since 2026-11-27 (G6 resolved)** the delivery actions send the typed events of
`packages/shared/src/delivery/client-events.ts` instead of those click ids: `delivery_apply_submitted`,
`delivery_invite_opened` (once per page view) / `_accepted`, `delivery_online_toggled`, `delivery_offer_viewed`
(once per offer, not per poll) / `_answered`, `delivery_job_step` (at_shop, pickup, at_customer, deliver with the
code outcome; fail with its reason; give_up), `delivery_photo_taken`, `delivery_contact_tapped`,
`delivery_document_submitted`, `delivery_shop_ready_marked` / `_return_confirmed` / `_switch_answered` /
`_mode_requested`, `delivery_rating_submitted`, `delivery_admin_action` (on success). Kept as generic clicks (no
typed event in the catalogue): screen views, admin tabs, payouts viewed / CSV, settings saved, document viewed,
invite revoked, vehicle edit, application rejected, shop-mode request withdrawn.

### Tests

Unit: `apps/web/test/demo-delivery.test.ts` (machines, CAS, 404, stage reveal, codes, photo, failed/return,
switch, shop mode, invite), `demo-delivery-payouts.test.ts`, `delivery-view.test.ts`, `delivery-contract.test.ts`
(the demo store's answers parse with the shared schemas; API client paths and bodies; payout key kept on retry),
`delivery-invite-redaction.test.ts`, `caddy-secret-paths.test.ts`; go-live fixes 2026-11-27 (below):
`delivery-golive-photos`, `delivery-golive-shop-handover`, `delivery-golive-portal-theme`, `delivery-error-codes`,
`delivery-golive-photo-links`, `delivery-golive-invite-session`. E2E `apps/web/e2e/delivery-agents.spec.ts`
(happy path desktop + mobile, role leak, failed + return, offer expiry at 15 min, shop ready + self-delivery request,
customer view) on `fixtures/delivery-world.ts`. Hindi gate: apply, invite, agent portal, agent-mode shop, customer and
admin pages. State audit: rows `DLV-*` (chunk E).

### Contract gaps (for the backend stream)

All answered by the backend (§ 16) and taken up by the web on 2026-11-27 (§ 16 "resolved"); the list below is
the historical request.

- G1 Invite web link path: the web serves `/partners/delivery-invite/{token}`; the email/WhatsApp link must use it.
- G2 `ShopOrder` (order-views) and `MyOrder` schemas must carry `delivery` (they strip unknown keys today); the web
  reads it when present.
- G3 `ApplicationStatusDto.kind` and the partner `ApplicationPage` row (PIN required) do not accept delivery-agent
  applications; the web reads the list with a tolerant guard and needs `vehicleType` and `cityCode` on the row.
- G4 Admin order → jobs: no route lists the jobs of one order; the web calls `GET /admin/delivery/jobs?view=all&orderCode=`.
- G5 Ratings and payouts DTOs/routes (founder rulings 2026-11-26) are pending; the web uses
  `PUT /me/orders/{code}/delivery-rating`, `GET /agent/me/earnings`, `GET|POST /admin/delivery/payouts`,
  `POST /admin/delivery/payouts/{id}/correct`, `GET /admin/delivery/payouts/summary?from&to`, and `rating`,
  `ratingAvg`, `ratingCount` fields on the agent DTOs.
- G6 Typed client analytics events for delivery (the web uses `click` ids meanwhile).
- G7 Pickup-code lock and job-detail flags for admin (`pickupLocked`, `deliveryLocked`, `retryAllowed`) are not on
  `AdminJobDetail`; the web hides the override/retry choices it cannot judge.
- G8 SOS / help number: the web calls the company support number (`lib/site.ts`); a per-city admin-editable number
  (like roadside's `sosPhone`) would satisfy rule 8.

### Partner frame and numbers (2026-11-27 night, partner portals UI upgrade batch C)

- The rider portal uses the shared `PartnerFrame` (narrow column): the status strip stays first, the tabs are a bottom
  bar under 1024 px and a navy side rail above; the page intro left the layout (an `sr-only` h1 keeps the heading), so
  the offer starts above the fold at 390 × 844. The online card's markup is unchanged.
- Offer card: `OfferTimer` (15 min window for the tread bar; a longer offer starts full); new-offer sound and
  vibration (`useNewWorkAlert('rider')`, on by default) and "Updated n min ago · Refresh".
- History: rows grouped by IST day with "{day} · n delivered". Documents: status as a coloured badge in words.
- Earnings: net **"Paid to you"** (`totalPaise`, corrections included) and jobs delivered as two tiles, the net per
  payout period as money-green bars, and **delivered per day for 14 days** from the new
  `GET /v1/agent/me/stats?days=` (Q-PP-F5): `AgentStatsQuery` (7–90, default 14) → `AgentDailyStats`
  (`packages/shared/src/delivery/agent-stats.ts`), repo `agentDailyStats` (`packages/db/src/repo/delivery-agent-stats.ts`,
  actor-scoped via `agentOfUser`, IST days zero-filled, `delivery_jobs_agent_status_idx`, no migration), behind the
  existing `/agent/*` auth, per-user rate limit and `deliveries:read`. Demo client computes it from the demo jobs.

## 17. Go-live fixes from the live QA run (2026-11-27)

From `D:\mechdost-qa\delivery-cod-sim-2026-11-27\logs\bugs.md`; one commit each, test first.

- **DC-P11 (P0):** job photos (pickup, delivery, failure) upload with the job id (`uploadPhoto(file, purpose, jobId)`;
  the API answers 422 `JOB_REQUIRED` without it). Document photos carry none.
- **DC-B11 (P1):** the sweep's selection was correct in tests (offer past `expires_at` expires, twice in a row); the
  sweep now audits each expiry, orders by `expires_at`, and the worker warns when due offers were not expired (§ 12).
  The production cause was not reproduced: check the worker log for `delivery_offer_expiry_failed` /
  `delivery_offers_not_expired` and compare open offers with `now()` on the server.
- **DC-B7 (P1):** the API answers the signed image route as `/v1/delivery-photos/{id}/large?e=…&s=…`; staff screens
  open it on the API origin (`deliveryPhotoHref`, `NEXT_PUBLIC_API_URL`). Document views stay audited
  (`viewAgentDocument`); job photo links come with the staff job detail, which is **not** audited per open yet
  (open item).
- **DC-B3 / DC-P5 / DC-P8 (P1/P2):** every error code the delivery routes and repositories return has en + hi words
  in `delivery.errors` and is in `DELIVERY_ERROR_CODES` (guard `apps/web/test/delivery-error-codes.test.ts` scans the
  route and the `delivery-*.ts` repositories); a plain `WRONG_CODE` maps to `WRONG_CODE_RETRY`; staff screens map
  before translating (next-intl prints the key path for a missing message, it does not throw). The rider document
  form checks the number (`documentNumberProblem`) before sending, so Aadhaar gets its own words.
- **DC-P4 (P1):** after a real invite acceptance the web reloads `/v1/me` with a fresh ID token and re-adopts the
  account, so the agent portal opens without signing out and in.
- **DC-P9 (P1):** the shop card picks the agent hand-over by the order's delivery mode (`shopAgentHandover`); a
  packed agent order without a job yet shows "Mark ready for pickup".
- **DC-P10 (P2):** the rider status strip uses `bg-surface` under `text-ink` (dark theme contrast).

- 2026-11-27 (founder): the rider "Take new jobs" card is a state card: green tint + outline when online, white outline on the hero when offline, power icon, 18 px label; the shared switch off-track uses `input-border` (≥ 3:1, WCAG 1.4.11) instead of `line`. Guard: `apps/web/test/delivery-online-card.test.ts`.
