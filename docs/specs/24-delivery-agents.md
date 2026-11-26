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
resume.

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
