# 04 · Orders: admin routing, shop acceptance, fulfilment, tracking

Status: decided · Phase 1 · Decisions: Core flow (CLAUDE.md), Multi-seller split, Tooling (pg-boss)

## Goal

The MechDost core loop: every order goes to the admin queue, the admin routes it to a shop, the shop accepts or declines within a timer, and the customer always knows what is happening.

## Roles

admin/ops/city_manager (route, reroute, reject), seller_owner/staff (accept, decline, pack, ship, deliver), customer (track, cancel), system (timers, notifications).

## States (sub-order level)

`placed` → `awaiting_shop` (assignment offered) → `confirmed` → `packed` → `shipped` → `out_for_delivery` → `delivered`; branches: `needs_rerouting` (declined/expired), `rejected` (admin, with message + refund), `cancelled` (customer/admin), `return_requested…` (spec 05). Parent order status is derived from sub-orders.

## Flow

1. Placement → sub-order `placed`; event `order.placed`; admin queue "Needs routing" with ranked eligible shops (all items in stock → distance to customer pincode → acceptance rate → rating → current load/starvation → price). "Route to recommended" one click, or pick manually. Optional auto-route toggle per city (admin setting).
2. Routing creates `order_assignments` row `offered` with `expires_at = now() + settings.acceptance_timeout_min` (default 30; per city/category); sub-order → `awaiting_shop`; shop notified (in-app realtime + sound + email; WhatsApp/SMS later). **Only one active assignment per order (partial unique index).**
3. Shop **Accept** → CAS `WHERE status='awaiting_shop' AND assignment.status='offered' AND expires_at > now()` → `confirmed`; stock reserved→committed; customer + admin notified "Order confirmed, will be shipped". **Decline** (reason required) or **timer expiry** (pg-boss job CAS) → assignment `declined|expired`, sub-order `needs_rerouting`, admin alerted with history.
4. Admin **Reroute** (new assignment; previous shop excluded) or **Reject** with canned, editable customer message ("We're sorry — this item can't be fulfilled right now…"); prepaid → automatic refund (spec 05); COD → nothing to refund.
5. Fulfilment: shop `packed` → `shipped` (mode own_delivery | courier with AWB; courier tracking webhooks P1 via Shiprocket/Delhivery) → `out_for_delivery` → `delivered` (optional OTP/photo proof). Each transition CAS + `order_events` row + notification.
6. Customer tracking page: stepper (concept `.care-progress` style), events, AWB link, "Need help" → ticket.

## Data

`orders`/`order_items` (spec 03), `order_assignments` (order_id, shop_id, status offered|accepted|declined|expired|withdrawn, offered_by, offered_at, responded_at, expires_at, decline_reason), `order_events` (append-only), `shipments` (mode, courier, awb, status, proof_url), `shop_metrics` (acceptance_rate, median_time_to_accept, on_time_rate — rolled up daily), `settings` (city: acceptance_timeout_min, auto_route, cancel_until_stage).

## API

Admin: `GET /admin/orders?status&city&shop&date&q`, `GET /admin/orders/:id` (with ranked shops), `POST /admin/orders/:id/route {shop_id}`, `POST /admin/orders/:id/reroute`, `POST /admin/orders/:id/reject {message}`, `POST /admin/orders/:id/cancel`. Shop: `GET /shop/assignments?status`, `POST /shop/assignments/:id/accept|decline`, `POST /shop/orders/:id/pack|ship|out-for-delivery|deliver`. Customer: `GET /orders`, `GET /orders/:code`, `POST /orders/:code/cancel`. All transitions carry `version`; 409 on conflict.

## UI

Admin queue cards with countdown chips and SLA colours; order detail with timeline and shop ranking table; shop portal order feed (big Accept/Decline, countdown, items, address, customer contact masked until accepted); customer tracking page with concept wording ("Order confirmed, will be shipped by {shop city}").

## Rules

Timer is DB-clock based; late accept after expiry is rejected (CAS); shop in busy/holiday mode is not eligible; partial fulfilment not allowed in phase 1 (split happened at checkout); admin cannot route to a shop lacking stock unless override flag with note; every state change audited.

- **Group totals and COD status (built 2026-11-11, review B7/B8):** the customer's order list and detail show `totalPaise` = what is still payable (sub-orders not cancelled or rejected) and `placedTotalPaise` = the total confirmed at checkout. A COD group becomes `cod_collected` when no sub-order is still open and at least one was delivered (set inside every terminal order move, group row locked). A COD group whose parts were all cancelled keeps `cod_pending` until the COD payment states are designed with the WhatsApp COD confirmation (Q74); moving the COD fee off a cancelled first part is Q66. Routing to the shop that already holds the stock renews those holds for the reservation window (never shortens them).

## Edge cases

Shop accepts exactly at expiry → whichever CAS wins is final; shop app offline → email/SMS fallback and admin alert at 50% of timer; customer cancels while `awaiting_shop` → assignment withdrawn; all eligible shops decline → admin reject flow; courier webhook out of order → monotonic state.

## Notifications & events

`order.routed` (shop), `order.confirmed` (customer, admin), `order.declined|expired` (admin), `order.rejected` (customer), `order.packed|shipped|out_for_delivery|delivered` (customer), `order.sla_breach` (admin). Outbox dedupe per (event, order).

## Analytics

`seller_order_accepted|declined`, `admin_order_routed`, `order_rerouted`, `order_rejected`, `time_to_accept_seconds`, `delivery_lead_hours`.

## Acceptance tests

20 concurrent accepts → one success; expiry vs accept race; decline → needs_rerouting → reroute excludes previous shop; reject prepaid triggers refund; cross-shop order read → 404; tracking stepper reflects each state; notification outbox has exactly one row per event.

## Open decisions

None (auto-route is an admin setting; default off).

## P1/P2

Courier integration webhooks, partial shipments, order edit before confirmation, split by item when one shop lacks part of a sub-order, penalties for cancel-after-accept, route by zone polygons.

## Built: admin routing API (2026-11-03)

`packages/db/src/repo/routing.ts`, `apps/api/src/routes/admin-orders.ts`, worker timer in `apps/api/src/worker.ts`.

- **Queue** `GET /v1/admin/orders?view=needs_routing|awaiting_shop|in_progress|closed&cursor&locale`: oldest first (FIFO), keyset cursor on (placed_at, id); each item has status, PIN, total, item count, version, shops already tried, and the current offer (shop + expiry). City scope = the cities of the staff member's `orders:read` grants (`cityScopeFrom`; global grant = all cities; another city's order = 404).
- **Order** `GET /v1/admin/orders/{code}`: items, offer history (shop, status, times, decline reason) and, while unrouted, the **ranked shops** covering the delivery PIN: eligible first (approved, not busy, every item in stock counting this order's own reservations, never a shop that already declined or let this order expire), then distance to the PIN centroid, acceptance rate over 30 days (null below 5 offers, research "minimum sample"), rating, price. Paused/suspended shops are never listed.
- **Route / reroute** `POST …/route {shopId, version}` (`orders:route`): eligible shops only (`SHOP_NOT_ELIGIBLE`), compare-and-set on the order version (`STALE_ORDER`); the order's stock reservations move to the chosen shop in the same transaction (released at the old shop, reserved at the new; `OUT_OF_STOCK` rolls back); offer timer = setting `orders.acceptance_timeout_min` (city → global, default **15 min** as in the demo decision); audit `order.routed` / `order.rerouted`.
- **Reject** `POST …/reject {reasonCode, message, version}`: only `placed`/`needs_rerouting`; `reasonCode` from `ORDER_REJECT_REASONS` (no_stock_nearby, all_shops_declined, unserviceable_address, suspected_fraud, pricing_error, other) + a customer message (10–500), both stored on the order (migration 0028, CHECK: a rejected order always has both); reservations released; WhatsApp `order.rejected` queued when enabled; audit. Prepaid refunds come with online payment (spec 05).
- **Timer** (worker, every 30 s): `expireDueAssignments` expires offers past their DB-clock deadline, one CAS transaction each (safe twice / on several workers) → `needs_rerouting`.
- **Stock hold expiry (scheduled 2026-11-09):** checkout and routing hold stock for `checkout.cod_reservation_minutes` (default 24 h, per city). The worker's sweep (`releaseExpiredReservations`, every 60 s) frees holds past that time, one transaction per hold with the order row locked first, so stock of an order nobody routed or accepted goes back on sale. A later **route** re-reserves (or the shop is not eligible), and **accept** re-reserves any lapsed hold at that shop inside the accept transaction — not enough stock → `STOCK_NOT_HELD` (409) and nothing changes, the offer stays for admin to reroute. Acceptance tests: `packages/db/test/shop-orders.test.ts` § stock hold expiry.
- **Shop side (built 2026-11-03, `packages/db/src/repo/shop-orders.ts`, `apps/api/src/routes/shop-orders.ts`):** verified shop owners/staff, scoped to the shops in their grants (other shops' offers and orders → 404; staff without a shop grant see nothing). `GET /v1/shop/orders?view=offers|active|done` (offers hide the customer's address; it is shared once the shop accepts) · `POST /v1/shop/offers/{assignmentId}/accept` (`assignments:respond`; CAS: the first accept wins, a late accept after expiry fails; the order's reservations, already held at this shop by routing, are **committed** in the same transaction, `STOCK_NOT_HELD` otherwise) · `POST …/decline {reasonCode}` (`ASSIGNMENT_DECLINE_REASONS`: out_of_stock, too_far, shop_closed, too_busy, price_mismatch, other → `needs_rerouting`) · `POST /v1/shop/orders/{code}/advance {to, version}` (`orders:fulfil`): `packed` → `shipped` (`mode` own | courier + courier name + AWB; creates the shipment) → `out_for_delivery` (issues the customer's delivery code, WhatsApp when enabled) · `POST …/deliver {deliveryCode, version}` (20 per 10 min per user): wrong code → `{ok:false, reason:'wrong', attemptsLeft}` and the order stays out for delivery, 5 wrong → locked (admin override); right code → shipment and order `delivered` together. The API loads the data keyring at start (`DATA_ENCRYPTION_*`; required in production; without it in development the delivery-code steps answer 409 `DELIVERY_CODES_UNAVAILABLE`). Lists: `GET /v1/shop/orders?view=offers|active` is the live working set (capped at 100); `view=done` (last 30 days) is newest first and keyset-paged (`nextCursor` → `?cursor=`).
- **Advisor review fixes (2026-11-03):** accept refuses a shop that is not `approved` (paused/suspended) with 403 `SHOP_NOT_ACTIVE`, reading the shop row `FOR SHARE` so a concurrent pause waits (decision 2026-11-01: no new work — an offer made before the pause included; the demo already refused); every shop action (accept, decline, packed, shipped, out for delivery, delivered) writes an audit row; the customer's address is returned only for `view=active` (not for offers, not after delivery).
- Built since: customer and staff cancel (spec 05), routing analytics events (`admin_order_routed` / `admin_order_rerouted` / `admin_order_rejected`, spec 12), `order_fulfilment_step` and `order_delivered` events; lock order "order row first" and a resilient timer loop (spec 14). Not yet: auto-route setting; 50 % timer alert; the admin console on the API.

## Demo implementation (2026-11-01)

Admin routing at `/admin/orders`, shop accept/decline at `/partner/shop`, customer tracking at `/orders/{code}` — on the browser store (`routeOrder`, `respondToOrder`, `rejectOrder`, `shopAdvanceOrder`, `routingState` in `apps/web/src/demo/store.ts`). Accept timer 15 min (`SHOP_ACCEPT_MINUTES`); suggestions from `rankShops` (category coverage → acceptance → speed; declined shops excluded). Acceptance test: `e2e/roles.spec.ts` "order routing across roles".

## Proof of delivery (decision 2026-11-01)

Out for delivery → `issueDeliveryCode(shipment)` (4 digits, `crypto.randomInt`, stored encrypted, attempts reset) → customer sees it on `/orders/{code}` (`deliveryCodeFor`, actor-scoped) and gets it by SMS/WhatsApp (spec 10) → delivery person enters it (`verifyDeliveryCode`: constant-time compare, CAS attempt counter, lock at 5) → shipment `delivered` + order transitions to `delivered` in the same transaction. Exception: `overrideDelivery` (permission `orders:route`, reason 5–300 chars, audited atomically). Staff reach it through `POST /v1/admin/orders/{code}/deliver-override {reason, version}` (built 2026-11-11, review B2; `overrideOrderDelivery`: city-scoped, order must be out for delivery, shipment override + order `delivered` in one transaction, event `admin_delivery_override`). Not yet: re-issuing a new code to the customer (queued). DB CHECK `shipments_delivered_needs_proof`. Analytics: `shop_delivery_confirmed`, `shop_delivery_code_wrong`, `admin_delivery_override`. Tests: `packages/db/test/integrity.test.ts` "proof of delivery", `apps/web/e2e/delivery.spec.ts`. Demo: `apps/web/src/demo/store.ts` (`confirmDeliveryWithCode`, `adminConfirmDelivery`; "Simulate next update" stands in for both steps).

## Routing with admin prices (built 2026-11-13, plan admin catalogue + PIN prices)

- Routing suggestions, quotes and order placement only consider shops whose approved price for every line is **at or below the customer price** of the order (the admin's PIN or city price, spec 02). A declined order can therefore be rerouted only to shops at or below that price.
- **Order items keep both prices**: `unit_paise` = what the customer pays; `shop_unit_paise` = the chosen shop's approved price at that moment (nullable on older rows; CHECK `>= 0` and `<= unit_paise`), so the margin per line is known for payouts and analytics. Snapshots: raising an admin price later never changes an existing order.
- Interim (Q83): with no admin price set, the customer pays the nearest shop's price, so rerouting cannot go to a dearer shop ("block it": never below what a shop is paid). Routing tests set admin city prices at MRP to keep testing the routing mechanics.

## Real API mode — customer side (2026-11-14, launch)

With `NEXT_PUBLIC_DATA_MODE=api`, `/orders/{code}` renders `OrderViewApi` (`components/commerce/order-view-api.tsx`):

- `GET /v1/orders/{code}` for the signed-in customer, refreshed every 30 s.
- Each part (one per shop) shows its seller, the six-step stepper, items and line totals.
- The delivery code appears only while the API returns it (out for delivery). A cancelled or rejected part shows its message.
- "Cancel" appears while the API says `canCancel`. The reason is never preselected (`PERSON_CANCEL_REASONS`), and the call sends the part's `version`.
- Signed out: a "sign in" link that returns to the order. Not yours or missing: "not found".

The account order list uses `GET /v1/orders` through `useOrderRows` (`lib/use-order-rows.ts`). One request serves the overview count and the list. The status label comes from `lib/order-status.ts` (unit test `apps/web/test/order-status.test.ts` covers every `ORDER_STATES` value).

## Real API mode (2026-11-14, Stream C2)

With real sign-in (`NEXT_PUBLIC_AUTH_MODE=firebase`) the shop portal and Admin → Orders read and act through the API; the demo screens are unchanged and the API screens load by dynamic import only in that mode (`shop-portal-api.tsx`, `shop-prices-api.tsx`, `admin-orders-api.tsx`; responses validated with `@mechdost/shared/order-views`; view rules in `apps/web/src/lib/order-views.ts`, unit test `apps/web/test/order-views.test.ts`).

- **Shop**: offers (`GET /v1/shop/orders?view=offers`, polled every 30 s while the tab is visible, timer from `expiresAt`), accept / decline with a reason code that is never preselected, orders in progress with one button per stage (`confirmed` → Mark packed; `packed` → Mark out for delivery = `advance shipped (mode own)` then `advance out_for_delivery`, so the customer gets the code; a half-done `shipped` order only repeats the second call), the customer's 4-digit code (`deliver`; wrong → tries left, locked → call support), delivered/cancelled of the last 30 days with "Load more". Every call sends the order `version`; every action reloads all lists; a failed load says so with "Try again" (never an empty list).
- **Admin**: four API views (needs routing, waiting for the shop — both polled every 30 s — in progress, closed split into delivered / rejected / cancelled) with "Load more". Open orders load their detail: items, offer history ("Declined by … : reason"; expired = no answer in time) and the API's ranked shops — only `eligible` and not `triedBefore`, top three, the first "Recommended", with distance, items in stock and acceptance rate. Route, reject (reason code + 10–500 character message, only `placed`/`needs_rerouting`), cancel (reason code; allowed statuses from `orderMachine`), and confirm delivery without the code (`deliver-override`, reason ≥ 5 characters) for `out_for_delivery`.
- **Not covered by the API yet** (gaps, demo-only on these screens): offers the shop missed (expired) are not listed for the shop; rejection message, cancellation details, delivery-code attempt count and override reason are not in the admin queue; courier hand-over (courier + AWB) has no button (own delivery only); the closed view is oldest first.

## Shop working hours in routing (2026-11-14, user)

User: "each seller individually configures it for their shop so during the routing time u can show it to admin that
this shop might be open and suggest to route via that and if admin routes to a closed shop then it goes to the shop
till morning until it opens and still then it waits for like an hour or smth and yeah keep it configurable".

- **Hours:** `shops.hours` = one window `{open, close, days}` in IST (0 = Sunday; close may be `24:00`), default
  09:00–21:00 Monday to Saturday (migration 0051). The owner sets them in the shop portal, staff in Admin → Partners →
  Shops (spec 07). Rules in `@mechdost/shared/shop-hours` (`shopOpenState`, `acceptanceDeadline`; IST weekday, not
  UTC).
- **Suggestions:** the ranked shops carry `openNow` and `opensAt`. Among eligible shops, open ones rank first, then
  distance and the rest as before. The admin card shows "Open now" or "Closed · opens {day, time}" and a note when a
  suggested shop is closed. The first suggestion (Recommended) is therefore an open shop whenever one is eligible.
- **Routing to a closed shop is allowed.** The offer reaches the shop at once (its list shows it). The accept deadline
  is the **next opening time + `orders.closed_shop_grace_min`** (admin setting, 15–240 min, default 60, city
  override), never earlier than the normal timeout. While the shop is open, the timeout is the shop's own minutes to
  accept (`shops.acceptance_timeout_min`), else the city setting `orders.acceptance_timeout_min`. The deadline is
  computed in the assignment insert (`offerOrderToShop` `expiresAt`), so the existing timer job expires it unchanged.
- **Stock hold:** routing extends the order's hold to at least the deadline + the timeout, so the morning accept does
  not fail with `STOCK_NOT_HELD`.
- **Shop and admin screens:** a deadline more than two hours away shows as "accept by {weekday, time}" instead of a
  minute countdown.
- **Tests:** shared `shop-hours.test.ts` (the opening minute in and closing minute out, the IST weekday at 00:30,
  Saturday night → Monday, 24:00, grace) and db `routing.test.ts` (open shops first with `opensAt`, a closed shop's
  deadline = opening + grace from the city setting, the hold covers the deadline, a shop's own minutes to accept).
- **Near closing = closed** (user 2026-11-14: "Yes, treat as closed"): if now + the timeout would pass today's
  closing time, the deadline is the next opening + grace (20:55 to a 21:00 close → tomorrow 09:00 + 60 min). A
  24:00 close running into a 00:00 opening is one window. Tests: shared `shop-hours.test.ts` "near closing".
- Routing tests use hours closed for the next two days, so passing IST midnight mid-test changes nothing.
- **Not done:** split windows (lunch breaks), holidays and a per-shop grace.

## Shop gives up an accepted order (2026-11-15; user ruling)

Design: `docs/superpowers/specs/2026-11-15-shop-give-up-warnings-design.md`.

- **Rule:** a shop that accepted an order may give it up **only while it is `confirmed`** (before packing), with a reason
  code (`ASSIGNMENT_GIVE_UP_REASONS`: out of stock, stock damaged, cannot deliver, shop closed, price issue, other) and an
  optional note (300 characters, staff-only). It goes **back to admin** (`needs_rerouting`), never auto-cancelled.
- **Machines:** assignment `accepted -> given_up` (shop); order `confirmed -> needs_rerouting` (shop). One transaction,
  order row locked first: assignment CAS on status, order conditional UPDATE on (status, version), `shop_id` and
  `confirmed_at` cleared, committed stock put back (`restoreCommittedStock`, the exact reverse of the accept), audit
  `order.given_up_by_shop`, event `seller_order_given_up`. Another shop's order and a repeat call are 404; packed or later
  is 409 `WRONG_STEP`; a stale version is 409 `STALE_ORDER` and changes nothing.
- **Customer:** not told. The status trigger hides the `confirmed -> needs_rerouting` timeline row from the customer
  (migration 0053); the order shows "confirming with a seller" again. When it is rerouted and confirmed again the customer
  gets the usual confirmation.
- **Admin:** the order is in "needs routing" with the reason line ("{shop} accepted this order, then gave it up: {reason}");
  the shop is still offerable and carries a "Gave this order up before" tag (declined and expired shops stay excluded).
- **Score and history:** `given_up` counts as answered, not accepted (acceptance rate in routing, `offersAnswered` in
  analytics); the shop's "Delivered" history lists the order as "Given up" with its reason, without the customer's details.
- **Staff notification:** the order and assignment triggers already ping city staff (live outbox); `notifyStaffShopGaveUp`
  is the hook for the push/email channels (ids and codes only).
- **Tests:** `packages/db/test/shop-give-up.test.ts` (stock back, re-route to the same or another shop, one active
  assignment, hidden from the customer, packed/foreign/stale/reason/note refusals, races: five give-ups, give-up vs pack,
  give-up vs staff cancel), `apps/api/test/shop-give-up.test.ts`, `packages/shared/test/state.test.ts`.
