# Real time across MechDost: research and recommendation (2026-11-01)

The owner's request: "all of the website needs to be real time. Any change in data should reflect instantly without causing any extra load or slowness … first study about it."

This report covers what should be live and how fresh it needs to be, the architecture that fits our stack, security, testing, and a phased build plan. It is research only: no code or other docs were changed. Items that need a ruling are listed in §11 for `docs/decisions.md` or the questions inbox.

## 1. The answer in brief

- **Not every screen needs a socket.** Data that people act on together needs **push**: shop offers with the accept timer, order and service status, the admin routing queue, bulk-quote chat, the notifications bell, and partner pause or suspend. Catalogue, content and settings need **fresh caches** instead: tag revalidation when something is published, and no socket at all. Anonymous shoppers never open a socket.
- **Transport: Supabase Realtime Broadcast, sent from the database, on private topics.** A trigger in the same transaction as the business change calls `realtime.send()`. Realtime reads it from the WAL, so only **committed** changes are ever announced. Postgres Changes is rejected: it re-checks RLS for every subscriber on every change, runs on a single thread, and does not apply RLS to DELETEs.
- **Payloads are thin pings, never data**: `{event, kind, id, version, at}`. The client checks `version`, then refetches through the actor-scoped API, which stays the only reader and enforces permissions. A stale or leaked subscription therefore learns nothing useful.
- **Low load by construction.** We open one socket per tab, and only on pages that need it, lazy-loaded (about 15 KB gz). The API on Cloud Run stays stateless and holds no sockets. Refetches are debounced and version-gated and use 304s. Clients poll only when the socket is down (15 s → 60 s backoff, visible tabs only). On reconnect or when a tab becomes visible again, the client does one refetch.
- **Cost at Raipur scale is close to nothing.** Launch fits inside Supabase Pro's included 500 peak connections and 5 M messages a month. At 10× growth the extra cost is roughly $25–40 a month (§7).
- **Instant, measured:** p95 from DB commit to UI updated under **1 s**, p50 under 400 ms. In fallback (polling) mode the bound is 15 s. Every ping carries `at`, so latency is sampled in the field.

## 2. Today's demo, and how it maps to production

`apps/web/src/demo/store.ts` (and `session.ts`, `coins.ts`, `site-config.ts`, `partner-status.ts`) keep each collection under one `localStorage` key:

| Demo mechanism                                                                             | What it gives                                                    | Production equivalent                                                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `write()` stores the value, then calls every in-tab listener                               | Same-tab updates (the `storage` event never fires in the writer) | Optimistic UI plus the mutation response: the actor sees their own write at once (read-your-own-writes)      |
| `window` `storage` event → listener                                                        | Other tabs **of the same browser** update instantly              | A Realtime ping on a private topic → refetch. Works across devices and people                                |
| `useSyncExternalStore(subscribe, snapshot, serverSnapshot)` with a raw-string cache        | Tear-free renders; an unchanged value keeps the same reference   | The same hook shape over a query cache (`useLiveQuery`, §8)                                                  |
| Guards in each transition (`routingState`, `o.shop?.slug === shopSlug`), returning `false` | A stale action is a no-op                                        | Conditional `UPDATE … WHERE status = $s AND version = $v` → 409 (already in `packages/db`)                   |
| `useNow(15_000)` ticks for countdowns; expiry is computed in the browser                   | Countdown display only                                           | A pg-boss job expires the assignment at `expires_at` (`expireAssignment`), and that write sends its own ping |

**Limits of the demo:** it is one browser only. A shop on a phone and a customer on a laptop cannot see each other, and nothing comes from a server. The countdown moves in 15-second steps, and an expired offer can stay on the shop list for up to 15 s.

## 3. What needs real time, and how fresh

"Push" means a Realtime ping followed by a refetch. "Revalidate" means a cache tag is invalidated when data is written, and the next request gets fresh data.

| Data                                                                                           | Who watches                      | Freshness target                                                   | Mechanism                                                                                        | Topic                                           |
| ---------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| New offered order + accept timer, offer withdrawn or expired                                   | Shop owner/staff                 | **≤ 2 s** (the timer is minutes long; the sound alert matters)     | Push + sound + badge; the countdown renders from server `expires_at`                             | `shop:{shopId}`                                 |
| Shop accepted / declined / timed out                                                           | Admin routing queue; customer    | ≤ 2 s                                                              | Push                                                                                             | `staff:city:{cityId}`, `user:{userId}`          |
| Customer order status (confirmed → packed → out for delivery → delivered), delivery code shown | Customer                         | ≤ 2 s                                                              | Push; the **code is fetched** from the actor-scoped endpoint, never sent in a ping               | `user:{userId}`                                 |
| Admin routing queue (needs routing, needs rerouting, SLA breach)                               | ops / city_manager               | ≤ 2 s                                                              | Push, jittered refetch                                                                           | `staff:city:{cityId}`                           |
| Admin KPI tiles (today's orders, acceptance rate, …)                                           | Staff dashboard                  | 10–60 s                                                            | Refetch on queue pings, **throttled to once per 10 s**; no separate stream                       | (reuses `staff:city:{cityId}`)                  |
| Service request: new request, proposal, accept, vehicle received, estimate lines, ready, bill  | Workshop, customer, admin        | ≤ 2 s                                                              | Push                                                                                             | `workshop:{id}`, `user:{id}`, `staff:city:{id}` |
| Bulk-quote thread (messages, new offer, accepted)                                              | Customer + negotiating staff     | **≤ 1 s** (feels like chat)                                        | Push on the thread topic → fetch messages after the last id (cursor)                             | `quote:{code}`                                  |
| Notifications bell (unread count)                                                              | Signed-in users                  | ≤ 5 s on portal/account pages; on focus or navigation elsewhere    | Ping when an in-app `notifications` row is inserted                                              | `user:{userId}`                                 |
| MechDost Coins balance                                                                         | Customer                         | Seconds–minutes                                                    | Ping on `coin_ledger` insert (free, since the user topic is already open); otherwise on focus    | `user:{userId}`                                 |
| Partner **pause / suspend**, role change, account deactivated                                  | That partner's portal; that user | ≤ 2 s in the UI. **Enforcement is in the API, immediately** (§9.3) | Push `partner.status_changed` / `session.changed` → portal re-checks `/me` and locks             | `shop:{id}` / `workshop:{id}`, `user:{id}`      |
| Partner applications, reviews to moderate, support tickets                                     | Staff                            | ≤ 10 s                                                             | Push (cheap) or refetch on focus                                                                 | `staff:city:{cityId}`                           |
| Catalogue: price, stock badge, new product                                                     | Everyone (anonymous)             | Seconds–minutes                                                    | **Revalidate** `product:{id}`, `category:{slug}:{city}`; checkout always reprices on the server  | none                                            |
| Workshop listing visibility (suspended → hidden; paused → "not taking bookings")               | Everyone                         | ≤ 30 s                                                             | Revalidate `workshop:{id}`, `workshops:{city}` with `{ expire: 0 }`; booking API refuses at once | none                                            |
| Home layout, content blocks, menus, policies, settings (fee, threshold, timer)                 | Everyone                         | On publish (≤ 30 s)                                                | Revalidate `content:{city}:{locale}`, `settings:{city}`                                          | none                                            |
| Cart                                                                                           | Owner (multi-device)             | On focus or navigation                                             | Refetch on `visibilitychange` / focus                                                            | none                                            |

### Where real time is not worth it

- **Product, category, search, home, workshop profile and content pages.** Anonymous traffic would multiply connections and cost, and the realtime client would eat into the 180 KB product-page JS budget. A price that is a few seconds stale is safe, because checkout reprices and asserts amounts on the server (hard rule 3).
- **Reviews, invoices, order history lists, profile, addresses, vehicles.** Only the owner edits these, so the mutation response is enough.
- **Analytics charts, audit log, exports, notification log.** Use a "Refresh" button or refetch on focus. Exports are pg-boss jobs that notify when done.
- **Typing indicators and "seen" ticks in the quote thread** at launch: these are nice-to-have and cost extra messages. Add them in Phase 2 if staff ask.
- **Polling loops of any kind** while the socket is healthy.

## 4. Options compared

| Option                                                                            | Latency                                               | DB / infra load                                                                                                                                         | Security                                                                                                       | Verdict                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase Postgres Changes** (subscribe to table rows)                           | Low                                                   | **Every change is authorised once per subscriber**, on a single thread; RLS throughput tops out at ~3–4 k msg/s whatever the compute size               | Leaks row data if a policy is wrong; **RLS is not applied to DELETE events**                                   | Rejected. Supabase itself recommends Broadcast "for scalability and security"                                                                                           |
| **Broadcast from the database** (trigger → `realtime.send` / `broadcast_changes`) | Benchmark: median 46 ms, p95 132 ms at 10 k inserts/s | One small insert into `realtime.messages` (partitioned daily, auto-dropped after about 3 days); Realtime reads it from the WAL                          | Private channels authorised by RLS on `realtime.messages` when a client joins; the payload is ours to minimise | **Chosen.** Atomic with the business write, committed changes only, can't be forgotten in app code                                                                      |
| Broadcast via REST from the API / worker (`POST /realtime/v1/api/broadcast`)      | Low                                                   | An HTTP call per event; no socket on the server (no billed connection)                                                                                  | Same channel authorisation                                                                                     | Use for **non-DB** events only (e.g. "export ready" from a job). Not for state changes: a crash between commit and send loses the ping                                  |
| Own SSE / WebSocket on Cloud Run                                                  | Low                                                   | Any instance holding an open stream is billed as active; streams are cut at the 60-minute request timeout; fan-out needs Redis pub/sub across instances | We build it all                                                                                                | Rejected for now (spec 16 already says "Realtime is Supabase's"). This is the exit path if we ever leave Supabase, because the thin-ping contract is transport-agnostic |
| Ably / Pusher                                                                     | Low                                                   | Vendor                                                                                                                                                  | Token auth                                                                                                     | Not needed. A new vendor, new keys, and data leaves our stack                                                                                                           |
| Polling only                                                                      | Interval/2 on average                                 | Constant load even when nothing changes                                                                                                                 | Fine                                                                                                           | Only as the **fallback** while the socket is down                                                                                                                       |

SSE compared with WebSockets: SSE is one-way, which would suit us. But on HTTP/1.1 browsers cap it at 6 connections per domain across all tabs, and Cloud Run bills instances while streams stay open. Supabase Realtime uses WebSockets with many channels multiplexed on one socket, which removes both problems.

## 5. Architecture

```
 Customer / Shop / Staff action
        │  HTTPS (Firebase ID token, Zod, rate limit, permission)
        ▼
 Hono API on Cloud Run (stateless)
        │  one transaction:
        │   • conditional UPDATE (status, version)   ← state machine
        │   • *_events row, audit_log row            ← existing triggers / repos
        │   • notification_outbox rows               ← email/SMS/in-app (durable)
        │   • AFTER trigger → realtime.send(ping)    ← new: live ping, same commit
        ▼
 Supabase Postgres ──WAL (committed only)──► Supabase Realtime ──private topics──► browser tabs / app
                                                                                     │
         pg-boss worker: expiry timers, outbox relay,                                 │ ping {kind,id,v}
         cache.revalidate → Next /api/revalidate (signed)                             ▼
                                                                         version check → debounced refetch
                                                                         GET /v1/... (actor-scoped, ETag/304)
```

### 5.1 Write path: why a trigger, not app code

- **Atomic and committed-only.** `realtime.send()` inserts into `realtime.messages` inside our transaction. Realtime picks it up through logical replication, and Postgres only decodes committed transactions ("Transactions that were rolled back … never get decoded"). A rolled-back transition therefore never sends a ping. This is the outbox pattern (hard rule 3) without a relay hop.
- **Impossible to forget.** Every path that changes `orders.status`, including pg-boss expiry jobs, admin overrides and webhooks, emits a ping, the same way `orders_status_event` already writes `order_events`.
- **Never breaks the business write.** `realtime.send` catches its own exceptions and reports them through `pg_notify`. Our acceptance tests must prove a failing send cannot roll back a transition (§10).
- **What stays on `notification_outbox`:** anything that must be **delivered**: in-app notification rows, email, SMS, WhatsApp, push. Pings are best-effort hints, and clients recover from a missed one by refetching on reconnect or focus.

### 5.2 Topics

The topic is the authorisation unit, so keep it narrow and few per tab.

| Topic                    | Members (checked by RLS when a client joins)                                                      | Carries                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `user:{userId}`          | That user only                                                                                    | Their orders, service requests, quotes, coins, bell, `session.changed`            |
| `shop:{shopId}`          | `user_roles` / `shop_users` rows for that shop (owner, staff)                                     | Offers, withdrawn/expired offers, their orders' changes, `partner.status_changed` |
| `workshop:{workshopId}`  | Workshop owner/staff                                                                              | Requests, customer accept, per-line approvals                                     |
| `staff:city:{cityId}`    | Staff whose role is scoped to that city (or unscoped super_admin/ops), with a relevant permission | Routing queue, quote inbox, applications, moderation, SLA alerts                  |
| `quote:{code}`           | The quote's customer + staff with `quotes:negotiate` in its city                                  | New message, new offer, accepted/declined (later: typing via client broadcast)    |
| `order:{code}` (Phase 2) | Staff only                                                                                        | **Presence** only: "Priya is handling this order"                                 |

One customer tab joins one topic (`user:`), plus `quote:` while a thread is open. A shop tab joins `shop:` + `user:`. A staff tab joins one `staff:city:` per city they manage. That is at most a handful of channels, well under the 100-per-connection limit.

### 5.3 Ping payload (contract in `packages/shared/src/realtime.ts`, Zod)

```ts
// Thin: identifies what changed, never what it now contains. No names, phones, addresses, amounts, codes.
export const LivePing = z.object({
  e: z.string().max(48), // 'order.status_changed', 'assignment.offered', 'quote.message', ...
  k: z.enum(['order', 'assignment', 'service', 'quote', 'notification', 'coins', 'partner', 'session']),
  id: z.string().max(40), // public code for customer-facing kinds (MD-RPR-…), uuid for internal
  v: z.number().int().nonnegative(), // row version after the change (0 when not versioned)
  at: z.string().datetime(), // clock_timestamp() at send, for latency sampling
});
```

Client rules:

1. **Drop stale and out-of-order pings.** Keep `lastVersion[k:id]`. If `v <= lastVersion`, ignore the ping. Otherwise mark the matching queries stale.
2. **At-least-once, idempotent.** A duplicate ping only causes an extra refetch, which is harmless. Handlers never apply money or state from a ping.
3. **Debounce per query key** for 250 ms, so a burst like accept → confirm → notification produces one refetch. On `staff:city` topics add 0–300 ms jitter, so ten staff tabs don't hit the API in the same millisecond.
4. **Validate** with `LivePing.safeParse`. If a ping is unknown or invalid, refetch everything on that topic once and log it (the contract test should catch this before release).

### 5.4 Read path: refetch, don't patch

Following TanStack Query author TkDodo's guidance on websockets ("send events from the backend instead of complete data objects"), pings **invalidate** queries, and the API returns the truth with permissions applied. Patching from payloads is reserved for one case: appending a chat message we just fetched by cursor. Because pings keep data fresh, live queries can use a long `staleTime`, and refetch on window focus becomes the fallback rather than the main mechanism.

The repo has no client data-fetching library yet. There are two options, which need a decision (§11):

- **TanStack Query** (≈13 KB gz, unverified: measure with the bundle analyzer): mature invalidation, dedupe, focus and reconnect handling. Load it only in client islands (portals, account, order, request and quote pages), never on product pages.
- **A ~100-line in-house `useLiveQuery`** over `useSyncExternalStore`, which is the same shape as the demo store. It is smaller but means more code to own.

**Server Component pages.** If a live page is rendered as a Server Component (for example the order tracking page for SEO-irrelevant but fast first paint), the ping handler can call `router.refresh()`. That re-renders the route's Server Components and keeps client state and scroll. It does **not** invalidate the server cache, which is correct here because these pages are dynamic and per-user. Debounce it the same way. Prefer a client island for frequently changing panels (offered orders, queue), because `router.refresh()` re-renders the whole route.

### 5.5 Static and ISR pages get fresh through tags, not sockets

The API is a separate service, so it cannot call `revalidateTag` itself. The flow is:

1. In the same transaction, the write adds an outbox job `cache.revalidate {tags}`. Catalogue and content repositories already know which tags they touch.
2. The pg-boss worker sends `POST https://web/api/revalidate` with an HMAC signature, a timestamp, and a rate limit. The route handler calls `revalidateTag(tag, 'max')` (stale-while-revalidate) for prices, stock and content. It uses `revalidateTag(tag, { expire: 0 })` when stale content must never be served again: a suspended partner, a hidden product, a withdrawn policy.
3. The same job invalidates the Upstash Redis tags (catalogue lists 60 s, settings/content 5 min; spec 16).
4. Admin Server Actions in Next (if any) use `updateTag` for read-your-own-writes, so the admin sees the published result on the next request.

Revalidation is lazy: Next regenerates a page when it is next requested, not all at once, so a publish does not cause a load spike.

### 5.6 Connection lifecycle (one socket per tab)

- **Lazy.** The realtime client (`@supabase/realtime-js`, about 15 KB gz, or the full `supabase-js` if Storage uploads need it anyway) is loaded with `import()` only when the first live hook mounts. The socket closes when the last live hook unmounts.
- **Auth.** Use the `accessToken` callback that returns the current Firebase ID token. Supabase is configured with Firebase as a third-party issuer, and users carry the custom claim `role: 'authenticated'` (§9.1). Refresh the token before its 1-hour expiry, which also re-checks channel permissions.
- **Heartbeats in background tabs.** Browsers throttle timers in hidden tabs and drop sockets silently. Use `worker: true` (heartbeat in a Web Worker) plus `heartbeatCallback` to reconnect on `'disconnected'`, as Supabase's troubleshooting guide recommends.
- **Backfill.** Missed pings are never replayed to the UI. Instead, (a) on every transition to `SUBSCRIBED` after the first, mark all of that topic's queries stale. (b) On `visibilitychange` → visible, refetch if the socket dropped or the last refetch is older than 30 s. Supabase does offer replay for database-sent messages on private channels (`since`, `limit ≤ 25`), but a refetch is authoritative and simpler.
- **Fallback polling.** If a channel reports `CHANNEL_ERROR` or `TIMED_OUT`, or the socket is down for more than 10 s (for example a corporate proxy blocking WebSockets), poll that page's live queries every 15 s → 30 s → 60 s while the tab is visible. Stop polling when the socket recovers. Emit the analytics event `realtime_fallback_started`.
- **Reconnect storms.** After a Realtime incident every tab reconnects at once. Supabase Pro allows 500 channel joins per second, and realtime-js backs off on its own. We add jitter to our first refetch after a reconnect.

### 5.7 Timers (shop accept countdown)

- The **server** decides expiry: a pg-boss job runs `expireAssignment` at `expires_at` with a conditional UPDATE, and the trigger pings `shop:`, `staff:city:` and `user:`. The browser never decides that an offer expired. It only renders the countdown.
- The countdown uses `expires_at` from the API plus a server-time offset taken from the response `Date` header, so a phone clock that is minutes off still shows the right time.
- Ticks: every 1 s only for a countdown that is on screen, with fewer than 10 minutes left, in a visible tab. Otherwise tick every 30 s. A `setTimeout` is scheduled for the exact deadline, so the "Expired" state appears on time even between ticks.

### 5.8 Presence (optional, Phase 2)

Staff presence on `order:{code}` shows "Priya is viewing" so two people don't try to route the same order. It is convenience only: the database CAS (one active assignment, partial unique index) is the real guard. Presence messages count towards billing and are limited to 10 keys per object, which is plenty here. Our security research (`security-vulnerabilities.md`) lists a Realtime advisory where `presence.read` RLS was not honoured, so keep presence on staff-only topics and keep the presence policy explicit.

### 5.9 Mobile app (later)

The same topics and contract work from React Native with supabase-js. Realtime is **foreground only**: on `AppState` → `active`, reconnect if needed and refetch. When the app is in the background, the **push channel** (FCM through `notification_outbox`, spec 10) wakes the user: for example "New order offered, 14:52 left" for shops. The web PWA can add Web Push later in the same way.

## 6. Keeping load low (the owner's "no extra load or slowness")

| Lever                               | Effect                                                                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No socket on public pages           | Most traffic (anonymous browsing) costs nothing extra, and the product-page JS budget is untouched                                                                    |
| One socket per tab, few channels    | Peak connections ≈ signed-in people with a live page open, not page views                                                                                             |
| Thin pings (≈150 bytes)             | Negligible bandwidth on 4G; no PII to protect in transit                                                                                                              |
| Version gate + debounce + jitter    | Each change causes at most one refetch per interested tab                                                                                                             |
| ETag / `If-None-Match` on live GETs | An unchanged refetch is a 304 with an indexed lookup                                                                                                                  |
| Narrow topics                       | A shop's ping reaches 1–3 tabs, not every shop. Split `staff:city` into `:routing` / `:quotes` once a city has >30 staff online                                       |
| No polling while healthy            | Zero idle API traffic. The e2e suite asserts this (§10)                                                                                                               |
| Triggers, not sockets, on the API   | Cloud Run stays stateless and scales to zero load per idle user                                                                                                       |
| Lazy revalidation                   | A publish regenerates pages on demand; no rebuild storms                                                                                                              |
| Bell outside portals                | On storefront pages, open the socket only if the user has something in flight (an active order, request or quote). Otherwise refresh the count on navigation or focus |

Extra DB work per state change: one small insert into a partitioned, auto-expiring table, plus WAL decoding inside Supabase. That is far below the cost of the `order_events` and `audit_log` writes we already do.

## 7. Quotas and cost (Supabase Pro)

Plan limits: 500 concurrent connections, 500 messages/s, 500 channel joins/s, 100 channels per connection, and 3,000 KB broadcast payload. Billing: 500 peak connections included, then $10 per 1,000. 5 M messages a month included, then $2.50 per million. A message counts once for the send and once per receiving client. The Free plan (200 connections, 100 msg/s) is for development only.

| Assumption                                            | Raipur launch          | 10× (multi-city)              |
| ----------------------------------------------------- | ---------------------- | ----------------------------- |
| Shops × devices / workshops / staff tabs              | 50×2 / 30 / 20         | 500×2 / 300 / 150             |
| Customers online with something in flight             | ~150                   | ~1,500                        |
| **Peak connections**                                  | **~300** (included)    | **~3,000** → about $25/month  |
| Orders + service requests per day                     | ~300                   | ~3,000                        |
| Messages per job (≈8 changes × ≈6 recipients + sends) | ~60                    | ~60                           |
| **Messages per month** (+ quotes, bell, coins ≈ +30%) | **≈ 0.7 M** (included) | **≈ 7–10 M** → $5–12.50/month |
| Peak messages per second                              | < 5                    | < 50 (limit 500)              |

The real ceiling sits well beyond spec 16's stage 2 (about 50 k orders/day): the Team plan allows 10,000 connections and 2,500 msg/s. If that ever binds, the thin-ping contract lets us swap the transport (own SSE fleet, Ably) without touching UI code.

## 8. The `useLiveTopic` / `useLiveQuery` design

```ts
// apps/web/src/lib/live/transport.ts: one interface, two implementations (demo: storage events; prod: Supabase)
export interface LiveTransport {
  subscribe(topic: Topic, onPing: (p: LivePing) => void, onStatus: (s: LiveStatus) => void): () => void;
}
export type LiveStatus = 'connecting' | 'live' | 'reconnected' | 'degraded'; // degraded = fallback polling

// apps/web/src/lib/live/use-live-topic.ts
export function useLiveTopic(topic: Topic | null, onChange: (p: LivePing) => void): LiveStatus {
  // 1. lazy-import the transport singleton; ref-count channels per topic (many hooks, one channel)
  // 2. on ping: LivePing.safeParse → version gate (module-level Map<`${k}:${id}`, v>) → onChange(p)
  // 3. on 'reconnected' or visibilitychange→visible (if stale > 30 s): onChange({ e: '*', ... }) → refetch all
  // 4. on 'degraded': start backoff poll (15→30→60 s) while document.visibilityState === 'visible'
  // 5. unsubscribe on unmount; close the socket when the ref-count reaches 0
}

// Usage: a query plus the topics that can change it; refetch debounced 250 ms (+ jitter on staff topics)
const offers = useLiveQuery({
  key: ['shop', shopId, 'assignments', 'offered'],
  fetch: () => api.shop.assignments({ status: 'offered' }),
  topics: [`shop:${shopId}`],
  match: (p) => p.k === 'assignment' || p.k === 'order',
});
```

`Topic` is a branded string built only by helpers in `packages/shared/src/realtime.ts` (`userTopic(id)`, `shopTopic(id)`, …), so the web, the app and the SQL agree on one spelling. The demo transport maps every demo `write()` to the same pings, so screens move to the API without being rewritten.

## 9. Security

### 9.1 Channel authorisation

- In Realtime settings, turn **"Allow public access" off**, so every channel must be private. All channels are created with `config: { private: true }`.
- Supabase third-party auth with Firebase. Each user needs the custom claim `role: 'authenticated'`, set by the same Admin SDK path that sets the RBAC claims. Without it, tokens run as `anon` and every join is refused (fail closed). Hosted Supabase rejects Firebase projects that are not registered. Even so, add the restrictive `iss`/`aud` check on `realtime.messages` as defence in depth, which costs little.
- Policies on `realtime.messages`: deny by default, with **SELECT** (receive) per topic family. There is **no INSERT** policy for `broadcast`, so clients can never send or spoof pings. Only the database does. Phase 2 adds an INSERT policy for `presence` on staff topics only.

```sql
-- Sketch for migration 00xx_realtime.sql (STABLE SECURITY DEFINER helpers, pinned search_path, indexed lookups)
create function public.rt_user_id() returns uuid language sql stable security definer set search_path = '' as $$
  select u.id from public.users u where u.firebase_uid = (select auth.jwt() ->> 'sub') and u.status = 'active'
$$;
create function public.rt_can_join(p_topic text) returns boolean language plpgsql stable security definer
set search_path = '' as $$ ... $$; -- user:{id} = rt_user_id(); shop:{id} via shop_users / user_roles.shop_id;
                                   -- staff:city:{id} via user_roles (city_id = id or null) + permission; quote:{code} …
create policy rt_receive on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.rt_can_join((select realtime.topic())));
```

Realtime evaluates policies when a client joins a channel and caches the result for the connection. That keeps the per-message cost at zero, unlike Postgres Changes.

### 9.2 No leaks by design

- **No PII or secrets in pings.** Names, phones, addresses, amounts and the delivery code never go out. Even a misconfigured policy would only reveal "order MD-RPR-… changed", and the follow-up refetch returns 404 for foreign ids (actor-scoped repositories, hard rule 3).
- Customer-facing pings use the public code. Shop pings for orders not yet accepted carry the assignment id only.
- Role-leak tests are mandatory (§10).

### 9.3 Suspension and revocation must not depend on the socket

Supabase states that a revoked user keeps receiving messages on joined channels until their JWT expires or a new token is sent. So:

1. **Enforcement is in the API**, which refuses the action at once.
   - **Finding:** the API currently caches sessions per instance for 60 s (decision 2026-10-31). Suspension or a role change therefore needs a shared signal. Bump `authz:ver:{userId}` / `authz:ver:shop:{shopId}` in Upstash Redis on every suspension or role change, and have the auth middleware compare it with the cached grant (one Redis GET per request, already on the hot path for rate limiting). Alternatively, drop the TTL to ≤5 s. Needs a ruling (§11).
2. **The UI locks promptly**: the `partner.status_changed` / `session.changed` ping makes the portal refetch `/me`, show the lock screen with the reason, and call `setAuth` with a fresh token, which re-runs the join policies.
3. **Short-lived tokens** (Firebase's 1 h) bound the residual window, and the payloads are thin anyway.

### 9.4 Abuse and rate limits

- Clients cannot publish. Joins are only for topics they are entitled to. The `/api/revalidate` route needs an HMAC, a 5-minute timestamp window, and an Upstash rate limit, and it accepts tags from a fixed allowlist of prefixes.
- Keep Realtime and supabase-js current: the internal research lists Realtime CVEs for string `exp` and presence RLS. Renovate security PRs should cover `@supabase/*`.

## 10. Testing and measuring "instant"

| Layer                 | Test                                                                                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (Vitest)         | `useLiveTopic`: version gate drops `v <= last`; out-of-order delivery; 250 ms debounce merges a burst; reconnect → one refetch; degraded → 15/30/60 s backoff, stops on recovery, paused when hidden (fake timers, fake transport)                                                     |
| Contract              | Every trigger's output parses with `LivePing`, and an allowlist test asserts the payload keys are exactly `{e,k,id,v,at}` (no PII creep). On PGlite, stub `realtime.send` to capture into a table; on Supabase local, use the real one                                                 |
| DB integrity          | A failing `realtime.send` never rolls back a transition. A rolled-back transition emits no ping. Each order transition emits exactly one ping per topic family. Expiry job → ping                                                                                                      |
| pgTAP (RLS matrix)    | Customer A ✗ `user:B`. Shop X staff ✗ `shop:Y`. Raipur city_manager ✗ `staff:city:{other}`. Suspended user ✗ any topic. No role can INSERT broadcast. `anon` ✗ everything                                                                                                              |
| E2E (Playwright)      | Two browser contexts (customer + shop, staff + shop): the shop accepts → the customer page shows "Confirmed" **without reload** within 2 s. A WebSocket frame spy (`page.on('websocket')` → `framereceived`) proves shop Y receives nothing for shop X's order                         |
| E2E idle              | With the socket healthy, 30 s idle on a portal → **0 API requests** (no hidden polling)                                                                                                                                                                                                |
| E2E chaos             | `page.routeWebSocket` closes the socket → the banner says "Live updates paused" (calm, `aria-live=polite`) and polling keeps updates ≤ 15 s; restore → polling stops. Offline → online → one refetch                                                                                   |
| E2E clock             | `page.clock` fast-forwards the accept countdown; the server expiry (test hook triggers the job) flips the shop list to Expired and the admin queue to "Needs rerouting"                                                                                                                |
| Load (k6, pre-launch) | 3,000 subscribers across topics + 50 writes/s for 10 min: p95 commit→client < 500 ms, no API p95 regression, DB CPU delta < 5%                                                                                                                                                         |
| Field measurement     | Client records `performance.now()` when the refetched data commits to the UI, minus `at` (corrected by the server-time offset), sampled at 1% → event `realtime_latency_ms`. Budgets: **p50 < 400 ms, p95 < 1 s, p99 < 3 s**; fallback ≤ 15 s. Alert on breach (spec 16 observability) |

Analytics (hard rule 9): `realtime_connected`, `realtime_reconnected`, `realtime_fallback_started` / `_ended`, `realtime_latency_ms` (sampled), `live_refetch` (counter per screen, to spot noisy topics).

## 11. Rulings needed (for `docs/decisions.md` PENDING table or the questions inbox)

| #   | Question                                                                            | Recommended default                                                                                                      |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| R1  | Realtime transport and pattern                                                      | Broadcast from the DB via triggers, thin pings, refetch through the API; Postgres Changes not used                       |
| R2  | Client data layer                                                                   | TanStack Query in client islands only (size to be measured), or an in-house `useLiveQuery` if the bundle budget is tight |
| R3  | Session-cache invalidation on suspend / role change (60 s per-instance cache today) | Redis `authz:ver:*` bump checked per request                                                                             |
| R4  | Bell socket on storefront pages                                                     | Only for users with something in flight; otherwise refresh on navigation/focus                                           |
| R5  | Presence and typing indicators                                                      | Phase 2, staff-only presence on `order:{code}`                                                                           |
| R6  | Supabase plan                                                                       | Pro before launch (Free's 200 connections / 100 msg/s are dev only)                                                      |

## 12. Phased build plan

### Step 0: demo (now, browser only)

1. **Introduce the transport seam.** Add `apps/web/src/lib/live/` with `LiveTransport`, `useLiveTopic` and `useLiveQuery`, plus a **demo transport**. Every demo `write()` emits the matching `LivePing` (e.g. `routeOrder` → `assignment.offered` on `shop:{slug}`, `staff:city:raipur`, `user:{phone}`). Delivery is in-tab through listeners and across tabs through the existing `storage` event (or a `BroadcastChannel`, which also reaches workers). Screens then consume "query + live topic" exactly as they will in production.
2. **Replace `useNow(15_000)` with a deadline-aware ticker** (§5.7). Tick every 1 s only for a visible countdown under 10 minutes, schedule an exact timeout at `expiresAt`, and pause in hidden tabs. This fixes the 15-second jumps and the late-expiry display in `shop-portal.tsx` and `admin-console.tsx`.
3. **Audit for non-live reads.** A quick grep found the demo already subscribes everywhere it matters: cart and checkout subscribe to settings; workshop finder, booking and partner gate subscribe to partner status. Keep a lint-style test that bans calling `siteSettings()` / `partnerStatus()` from components that don't also subscribe.
4. **Add `e2e/live-tabs.spec.ts`.** Two pages in one context (they share `localStorage`): admin routes in tab A → the shop sees the offer in tab B; shop accepts → the customer order page and the admin queue update; admin suspends → the portal locks; a quote message appears in the other tab. Add the idle no-polling assertion. These carry over to step 1 with two real accounts.
5. Copy for the demo note: "Live across tabs in this browser; across devices after launch" (en + hi in the locale files).

### Step 1: API + Supabase Realtime wiring (Phase 1, alongside the orders API)

1. **Shared:** `packages/shared/src/realtime.ts` (`LivePing`, `Topic`, topic builders, event names matching spec 10's event list).
2. **Migration `00xx_realtime.sql`:**
   - `rt_user_id()`, `rt_can_join(topic)`, SELECT policy on `realtime.messages`, and the restrictive Firebase `iss`/`aud` policy.
   - A generic `public.rt_ping(kind, event)` trigger function (`SECURITY DEFINER`, `search_path = ''`) that builds the topics from the row and calls `realtime.send(payload, event, topic, true)`.
   - Triggers:
     - `orders` AFTER UPDATE OF status → `user:{user_id}`, `shop:{shop_id}` (if set), `staff:city:{city_id}`
     - `order_assignments` AFTER INSERT/UPDATE → `shop:{shop_id}`, `staff:city:{city_id}` (via the order)
     - `shipments` (out for delivery / delivered) → `user:`, `shop:`
     - `notifications` AFTER INSERT → `user:{user_id}`
     - `coin_ledger` AFTER INSERT → `user:`
     - `shops` AFTER UPDATE OF status → `shop:{id}`, `staff:city:`
     - `user_roles` AFTER INSERT/DELETE, `users` AFTER UPDATE OF status → `user:{id}` (`session.changed`)
     - Later: `service_requests` / proposals / estimate lines, `quote_messages`, `quote_offers`, `partner_applications`, `support_tickets`.
3. **Supabase config:** private-only Realtime, Firebase third-party auth, and the `role: authenticated` claim in the claims sync. Record the settings in `docs/runbooks/setup.md`.
4. **API:**
   - `GET /v1/me/live-topics` returns the topics this actor may join. The client never guesses, and the list matches `rt_can_join`.
   - ETag on live GETs.
   - `authz:ver` invalidation (R3).
   - Outbox job `cache.revalidate` → signed `POST /api/revalidate` in Next (`revalidateTag(tag, 'max' | { expire: 0 })`) + Redis tag purge.
5. **Web:** the Supabase transport (lazy, `worker: true`, `heartbeatCallback`, `accessToken` from Firebase); swap the demo transport behind an env flag; status banner copy in the locale files; analytics events.
6. **Acceptance tests (mandatory, §10):** unit + contract + DB integrity + pgTAP matrix + the two-context e2e (customer/shop, staff/shop, customer/staff quote) + idle + chaos + clock. Then k6 before launch.
7. **Docs in the same change:** spec 16 (live budgets + fallback), spec 10 (bell via `user:` ping), spec 13 (channel policies, revocation), spec 04/06/19 (topics per transition), data model, decisions entry.

### Step 2: hardening and extras

Staff presence on `order:{code}`; quote typing indicator; split `staff:city` topics by queue when a city grows; field latency dashboard and alerts; mobile app (AppState reconnect + FCM for background); Web Push for the PWA.

## Sources

- Supabase, Subscribing to database changes (Broadcast recommended over Postgres Changes, `broadcast_changes` trigger, private channels): https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
- Supabase, Postgres Changes: scaling and limitations (per-subscriber authorisation, single thread, DELETE not RLS-filtered): https://supabase.com/docs/guides/realtime/postgres-changes
- Supabase, Broadcast (`realtime.send`, REST endpoint, `self`/`ack`, replay, storage of DB messages): https://supabase.com/docs/guides/realtime/broadcast
- Supabase blog, Broadcast from Database (replication slot on `realtime.messages`, `realtime.send` safe in triggers): https://supabase.com/blog/realtime-broadcast-from-database
- Supabase, Realtime Authorization (RLS on `realtime.messages`, `realtime.topic()`, policies cached per connection, revocation until JWT expiry, "Allow public access"): https://supabase.com/docs/guides/realtime/authorization
- Supabase, Realtime limits: https://supabase.com/docs/guides/realtime/limits
- Supabase, Realtime benchmarks: https://supabase.com/docs/guides/realtime/benchmarks
- Supabase, Usage: Realtime messages: https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages
- Supabase, Usage: Realtime peak connections: https://supabase.com/docs/guides/platform/manage-your-usage/realtime-peak-connections
- Supabase, Firebase Auth as a third-party provider: https://supabase.com/docs/guides/auth/third-party/firebase-auth
- Supabase troubleshooting, Silent disconnections in background applications (`worker: true`, `heartbeatCallback`): https://supabase.com/docs/guides/troubleshooting/realtime-handling-silent-disconnections-in-backgrounded-applications-592794
- Supabase troubleshooting, Realtime heartbeats (React Native AppState reconnect): https://supabase.com/docs/guides/troubleshooting/realtime-heartbeat-messages
- Supabase discussion, reconnect and reload missed data after backgrounding: https://github.com/orgs/supabase/discussions/28908
- PostgreSQL, Logical decoding output plugins (commit order; rolled-back transactions never decoded): https://www.postgresql.org/docs/current/logicaldecoding-output-plugin.html
- Next.js, `revalidateTag` (profiles `'max'`, `{ expire: 0 }`, lazy revalidation): https://nextjs.org/docs/app/api-reference/functions/revalidateTag
- Next.js, `updateTag` (Server Actions, read-your-own-writes): https://nextjs.org/docs/app/api-reference/functions/updateTag
- Next.js, `useRouter` / `router.refresh()`: https://nextjs.org/docs/app/api-reference/functions/use-router
- TkDodo, Using WebSockets with React Query (event-based invalidation, high `staleTime`): https://tkdodo.eu/blog/using-web-sockets-with-react-query
- Google Cloud, Using WebSockets on Cloud Run (60-minute timeout, active-instance billing, best-effort affinity): https://docs.cloud.google.com/run/docs/triggering/websockets
- MDN, EventSource (SSE one-way; 6-connection limit on HTTP/1.1): https://developer.mozilla.org/en-US/docs/Web/API/EventSource
- MDN, `storage` event (not fired in the writing window; fired in other same-origin tabs): https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event
- MDN, Broadcast Channel API: https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API
- Playwright, Mock APIs / WebSocket routing (`page.routeWebSocket`): https://playwright.dev/docs/mock
- Playwright, Clock (Java reference used for method semantics): https://playwright.dev/java/docs/api/class-clock
- DepScope, `@supabase/realtime-js` bundle size (third-party, ≈15.5 KB gz; verify with the bundle analyzer): https://depscope.dev/pkg/npm/@supabase/realtime-js
- Internal: `docs/research/security-vulnerabilities.md` §4 (Realtime CVEs), `docs/specs/16-performance-scalability.md`, `docs/specs/10-notifications.md`, `docs/specs/04-orders-routing-fulfilment.md`, `docs/specs/13-rbac-security-abuse.md`, `docs/decisions.md` (2026-10-31 API foundations: 60 s session cache)
