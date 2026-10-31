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
