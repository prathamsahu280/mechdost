# Real-time transport alternatives to Supabase Realtime (2026-11-01)

The owner asked: "find alternatives for supabase realtime, maybe our own backend and api can help with that, we even have firebase right".

The goal is unchanged from `research/realtime.md`: instant updates across tabs, devices and roles, with no extra load and no slowness. Examples: an order is routed and the shop sees it at once; the shop accepts and the customer and admin update; the admin pauses a partner; delivery status changes.

This is research only. No code or other docs were changed. Adopting anything here needs a dated entry in `docs/decisions.md`, because the stack decision (2026-10-31) says "Realtime/Storage: Supabase".

**What stays the same whatever we pick** (from `realtime.md`):

- Thin pings `{e, k, id, v, at}`: no PII, a version gate on the client, and a debounced refetch through the actor-scoped API.
- No sockets for anonymous shoppers.
- Cache-tag revalidation for catalogue and content.
- Polling fallback.
- Push (FCM) for the mobile app in the background.

Only the **pipe** that carries the ping changes.

## 1. The answer in brief

- **Ship a transport seam first, then pick the pipe.**
  - Add a `live_outbox` row in the same transaction as the business change.
  - A relay in the existing pg-boss worker publishes the ping **after commit**. It is woken by `NOTIFY`, with a 1 s sweep as the backstop.
  - The publisher is a `LivePublisher` interface, so the transport can be swapped without touching UI or SQL.
- **Recommended pipe now: Firebase Realtime Database (RTDB), used only as a per-user "inbox" of thin pings**, on the Blaze plan.
  - It costs **about $0 at Raipur scale**: bandwidth-billed, 10 GB/month free, 200k simultaneous connections per database.
  - We already have the Firebase project, and every signed-in user already has a Firebase session.
  - It is the strongest mobile story: native SDKs plus FCM from the same vendor.
  - Data stays in Postgres; RTDB only holds "entity X changed to version v".
- **Our own SSE from Hono on Cloud Run is the in-house alternative.** It is a better fit on security and lock-in: no new vendor, auth by our own middleware, topics derived server-side from the actor, an instant server-side kill on suspension, and nothing leaves Mumbai.
  - It is **not free**. Any open stream keeps a Cloud Run instance billed, so expect roughly **$45–65/month per always-busy instance** in Mumbai (see §3.1).
  - Each instance holds at most 1,000 connections, so cost grows with peak connections (≈ $300–450/month at 100k daily users).
  - We would own reconnection, heartbeats, fan-out and deploy drains.
  - Keep it as the documented Plan B adapter.
- **Supabase Broadcast-from-DB (the current plan) is still the simplest _if_ we move to Supabase Pro.** It is atomic with the commit and needs no relay. On the **Free** plan it caps at **200 concurrent connections and 2 M messages/month**, and the earlier study estimated ~300 peak connections at launch, so Free does not fit production.
- **Polling with ETag** stays as the always-on fallback and cost floor. It gives 15 s worst-case freshness and is zero-vendor.

## 2. Baseline: Supabase Realtime Broadcast from the database

How it works today in the plan: an AFTER trigger calls `realtime.send()` inside the business transaction. Realtime reads it from the WAL, so only committed changes are announced. Clients join private topics authorised by RLS on `realtime.messages`.

| Limit                    | Free                         | Pro                                  |
| ------------------------ | ---------------------------- | ------------------------------------ |
| Concurrent connections   | **200**                      | 500 included, then $10 per 1,000     |
| Messages per month       | **2 M** (no overage billing) | 5 M included, then $2.50 per million |
| Messages per second      | 100                          | 500                                  |
| Channel joins per second | 100                          | 500                                  |
| Channels per connection  | 100                          | 100                                  |
| Broadcast payload        | 256 KB                       | 3,000 KB                             |
| Project pausing          | After 1 week of inactivity   | Never                                |

**What happens at the limit:**

- **Joins over the limit are refused** with `too_many_connections`, `too_many_joins` or `too_many_channels`.
- **Too many messages per second** disconnects clients with `tenant_events`. supabase-js reconnects once throughput falls.
- **Monthly quota on Free**: you get an email and a **grace period**. Supabase may then disable Realtime for the project after review: "connections will fail to establish and existing subscriptions will stop receiving events".
- **Message counting**: a broadcast counts once when sent and **once per receiving client**.

**Verdict.**

- Best fit technically: commit-atomic, no relay, RLS join auth.
- Weak spots:
  - Free-plan caps.
  - A second auth system (Firebase as a third-party issuer, plus a `role: authenticated` claim hack).
  - Join authorisation is cached per connection, so a revoked user keeps receiving until their JWT expires.
  - Another SDK in the client (~15 KB gz).
- Fine if we go Pro anyway ($25/month base, decision R6 in `realtime.md`).

## 3. Our own SSE from the Hono API on Cloud Run

Shape: a separate Cloud Run service `mechdost-live`, built from the same image as the API with a different entrypoint. It holds `text/event-stream` responses (Hono `streamSSE`). Fan-out across instances goes through Upstash Redis pub/sub, or through Postgres `LISTEN/NOTIFY`.

### 3.1 Cloud Run facts that decide the design

- **Timeout.** Streams count as requests. The default timeout is 5 min and the **maximum is 60 min**, after which the client is cut and must reconnect. Google recommends designing for reconnects, because a reconnect may land on another instance (session affinity is best-effort only).
- **Concurrency.** The maximum is **1,000 concurrent requests per instance**, so 1 open stream uses 1 slot. CPU below 1 vCPU **forces concurrency 1 and request-based billing**, so an SSE instance needs **at least 1 vCPU**.
- **Billing.**
  - Request-based billing (the default) allocates CPU only while a request is in flight. An open SSE stream _is_ a request in flight, so **any instance with one open stream is billed all the time**.
  - Instance-based billing charges the whole lifecycle at a lower unit rate. Google recommends it for steady traffic.
  - For a portal that shops keep open all day, either way it behaves like an always-on instance.
- **Rough price.** One always-busy instance (1 vCPU, 512 MiB, 730 h) costs about **$45–65/month** in asia-south1.
  - This assumes Tier-2 rates of roughly $0.000018–0.000025 per vCPU-s.
  - Google's pricing page did not render, and third-party snapshots disagree on the exact rate and on whether Mumbai is Tier 1 or Tier 2. **Verify in the Cloud Run calculator before relying on it.**
- **Keep it out of the main API service.**
  - Long streams hold concurrency slots meant for API calls and skew autoscaling.
  - They also stop scale-in, and every deploy cuts them all at once.
  - A dedicated `live` service keeps the API stateless, as hard rule 7 requires.
- **HTTP/2.** Don't enable end-to-end HTTP/2 for streaming. Google's front end serves browsers over HTTP/2 anyway, which avoids the HTTP/1.1 limit of 6 SSE connections per domain across all tabs (MDN). Even so, share **one stream per browser** with a leader tab (Web Locks + `BroadcastChannel`).

### 3.2 Vercel cannot hold the streams

Vercel Functions (Fluid compute) top out at **300 s on Hobby and 800 s on Pro** (1,800 s in beta), and they bill provisioned memory for the whole duration. WebSockets on Vercel are a public beta. Next.js pages therefore connect **directly** to `live.mechdost…` on Cloud Run. No stream goes through Vercel.

### 3.3 Fan-out options

| Option                                        | How                                                                                                                                       | Cost / limits                                                                                                                                                                                                                                                                                                                                                 | Notes                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Upstash Redis pub/sub**                     | The relay `PUBLISH`es to `live:{topic}`. Each live instance keeps one TCP connection (ioredis) on `PSUBSCRIBE live:*` and filters locally | Free: 500 k commands/month. Pay-as-you-go: $0.20 per 100 k commands; 10 k commands/s cap. 1 `PUBLISH` = 1 command. **Upstash does not document whether each message delivered to a subscriber is billed.** If it is, switch to a Fixed plan ($10/month for 250 MB), which has no per-command billing. Ask support@upstash.com before relying on pay-as-you-go | Fire-and-forget: a subscriber that is down misses the message. That's fine, because the client resyncs on reconnect. Replay needs Redis Streams (`XADD … MAXLEN ~50`), which costs extra commands                                                                                                                                                           |
| **Postgres `LISTEN/NOTIFY`**                  | A trigger calls `pg_notify('live', ping)`. Each live instance holds one session connection with `LISTEN live`                             | Free, but each instance uses a DB connection. Transaction-mode pooling (port 6543) **does not support LISTEN**. Use Supavisor **session mode on 5432** (IPv4) or the direct connection (IPv6 only)                                                                                                                                                            | **Delivered only at commit** (same guarantee as `realtime.send`); payload < 8,000 B. Caveat: a transaction that issued `NOTIFY` takes a **global lock at commit**. Recall.ai saw commits serialise under heavy write load (they report a later fix in core; verify which release). Use it **only as a wake-up**, at most one per transaction, never per row |
| **Recommended combination (if we build SSE)** | `NOTIFY` wakes the single relay (one DB connection). The relay `PUBLISH`es to Redis, and the live instances subscribe to Redis            | One DB connection in total, not one per instance                                                                                                                                                                                                                                                                                                              | Keeps the DB out of the stream fleet                                                                                                                                                                                                                                                                                                                        |

### 3.4 Protocol details

- **Auth with a Firebase ID token.**
  - Native `EventSource` cannot send an `Authorization` header. Use a **fetch-based SSE client** (`ReadableStream`, about 60 lines, or `@microsoft/fetch-event-source`, which needs a dependency review first) with `Authorization: Bearer <ID token>`.
  - The stream is verified by the **same Hono auth middleware** as every API call.
  - The server derives the topics from the actor (`user:`, `shop:` via `shop_users`, `staff:city:` via `user_roles`). The client cannot ask for a foreign topic, because it never names topics at all.
  - Don't put tokens in the query string: they end up in logs.
- **Lifetime.** The server ends each stream at **50–55 min, with jitter**. That is below both the 60-min Cloud Run cap and the 1-hour Firebase token expiry. The client reconnects with a fresh token, so **every reconnect re-checks permissions**.
- **Reconnect and `Last-Event-ID`.**
  - Every event has `id:` (a monotonic per-instance ULID), and the server sends `retry: 3000`.
  - On reconnect the client sends `Last-Event-ID`.
  - Simplest correct server behaviour: if we can't prove there was no gap, send `event: resync`, and the client refetches its live queries once.
  - Optional later: replay from a per-user Redis Stream to avoid the refetch burst.
- **Heartbeats.** Send a comment line (`: ping`) every 25 s, so proxies keep the connection open and the client detects a dead stream within 60 s.
- **Revocation.** When a user is suspended or their role changes, the relay publishes `session.changed`. The instance holding that user's streams **closes them server-side** after sending the ping. The next reconnect fails the auth check. This is stronger than Supabase or Firebase, where an open socket lives until the token expires.
- **Deploys.** On SIGTERM, send `event: reconnect` with a jittered `retry`, then close. This avoids a reconnect stampede.
- **Mobile.** React Native has no native `EventSource`, so it needs a polyfill such as `react-native-sse`, and the connection is foreground only. This is the weakest mobile story of all the options.

### 3.5 Verdict

- **Pros:**
  - No new vendor.
  - One auth system: our middleware and our permission code.
  - Actor-scoped by construction.
  - Instant server-side revocation.
  - Data never leaves Mumbai.
  - Full observability in our logs.
- **Cons:**
  - Always-billed instances from day one.
  - 1,000 connections per instance.
  - Hourly reconnects.
  - We own the reliability code.
  - A weaker React Native story.
- **Use it** as Plan B, or at scale if we want to leave Firebase. For a much larger fleet, run it as Centrifugo or SSE on a VM instead of Cloud Run (§5).

## 4. Firebase as a notification channel only

The rule: Postgres stays the only source of truth. Firebase holds **markers** ("order MD-… is now version 7"), never business data. The client reads the marker and refetches through our API.

### 4.1 Realtime Database (recommended) vs Firestore

| Fact                 | Realtime Database                                                                                                                                                                       | Cloud Firestore (Standard)                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free (Spark)         | **100 simultaneous connections**, 1 GB stored, 10 GB/month downloaded                                                                                                                   | 50 k reads/day, 20 k writes/day, 1 GiB stored, 10 GiB/month egress                                                                                                                      |
| Blaze                | **200 k simultaneous connections per database**. Free allowance kept (360 MB/day downloads), then **$1/GB downloaded**, $5/GB-month stored. Use more databases to scale past the limits | Free daily allowance kept, then about **$0.03 per 100 k reads and $0.09 per 100 k writes** (us-central1; the Mumbai rate wasn't retrievable, verify)                                    |
| What is billed       | **Outbound bytes plus storage only.** Connections and writes are not separate items. Overhead counts: about 3.5 KB per TLS handshake and tens of bytes per message                      | **One read per listener per changed document.** Minimum 1 read per query. A listener offline for more than 30 min is re-billed as a new query. Rules using `get()`/`exists()` add reads |
| Write throughput     | About 1,000 writes/s per database (soft limit), about 100 k simultaneous responses/s                                                                                                    | High                                                                                                                                                                                    |
| Region               | **No India region.** Only us-central1, europe-west1, and **asia-southeast1 (Singapore)**; the location cannot be changed later                                                          | **asia-south1 (Mumbai) and asia-south2 (Delhi) available**                                                                                                                              |
| Latency              | Firebase positions RTDB as the low-latency product. Mumbai–Singapore RTT is about 60–75 ms, so expect about **150–350 ms** from commit to the client ping, including the relay          | Typically higher than RTDB. In Mumbai the network leg is shorter                                                                                                                        |
| Cost per 1 M updates | About 0.3–0.5 KB billed each → **≈ $0.15–0.50**, and $0 inside the free 10.8 GB/month                                                                                                   | 1 M reads + about 1 M writes → **≈ $1.20**, with the first ~1.5 M reads/month free                                                                                                      |
| SDK                  | `firebase/database` on top of the `firebase/app` + `firebase/auth` already loaded on signed-in pages. Lazy-import it and measure the size                                               | The Firestore SDK with listeners is much heavier, because its offline cache machinery is useless for pings                                                                              |

**Pick RTDB.**

- It bills bytes, not reads, and a thin ping is tiny.
- It has lower latency and a smaller SDK.
- 200 k connections per database covers us far past spec 16's stage 2.

Firestore's Mumbai region is its one real advantage. It matters only if a DPDP ruling forbids even pseudonymous pings leaving India. DPDP currently restricts transfers only to notified countries; treat that as a question for the user and not a blocker.

### 4.2 Data shape and security rules

The worker resolves recipients from Postgres at send time, so the rules never need membership data:

```
/inbox/{firebaseUid}/{kind}~{entityId} = { e: 'order.status_changed', v: 7, at: 1793... }   // one node per entity, overwritten
```

```json
{
  "rules": {
    "inbox": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": false
      }
    }
  }
}
```

- **One-line rule.**
  - Clients can only read their own inbox and can never write; the Admin SDK in the worker bypasses rules.
  - There is no custom-claims dependency. Claims must stay under 1,000 bytes and only refresh with a new token, so a list of shop ids in a claim would be fragile.
  - Topic membership, such as "who is staff for shop X" or "which staff cover city Y", stays in Postgres and in our code, which is actor-scoped by construction.
- **Bounded and self-deduplicating.**
  - Each entity has one key, overwritten with the newest version.
  - The client listens with `onChildAdded` + `onChildChanged` from "now − 60 s" and applies the existing version gate.
  - A nightly job deletes entries older than 24 h.
- **Fan-out cost.**
  - A shop ping writes 1–3 nodes (owner plus staff).
  - A `staff:city` ping writes one node per staff member in that city (about 20 at launch).
  - Uploads are not billed. Only the downloads to listening clients are.
  - If one city ever has more than about 100 staff online, switch that family to `/topics/{topic}` with an ACL node mirrored by the worker.
- **Opaque ids.** Use uuids, not public order codes, in RTDB entries. Then nothing in Singapore links to a person without our API.
- **Abuse.**
  - Turn on App Check.
  - Rules-denied reads are still billed, and budget alerts don't cap spend, so set a budget alert and watch the "simultaneous connections" chart.
- **Revocation.**
  - The worker stops writing to a suspended user at once, because membership is resolved per send.
  - Disabling the Firebase user and revoking refresh tokens bounds any open socket to the token's lifetime (≤ 1 h).
  - Enforcement stays in the API, as Q29 in `realtime.md` requires.

### 4.3 Mobile

- React Native Firebase (`@react-native-firebase/database`) wraps the native iOS and Android SDKs, which handle reconnects, network changes and AppState transitions.
- **FCM**, already planned for background push in spec 10, comes from the same project, the same SDK family and the same console.
- This is the strongest mobile story of all the options. Supabase-js works in React Native but is foreground only; our SSE needs a polyfill.

### 4.4 The double-write risk and how the outbox removes it

Writing to Firebase from request code creates two systems with no shared transaction:

| Failure                                                   | Effect without an outbox                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Marker written, then the Postgres tx rolls back           | Ghost ping for a change that never happened (the refetch shows the old version) |
| Postgres commits, then the process dies before the marker | **Missed ping**: the UI stays stale until focus or a poll                       |
| Two writers race                                          | Markers arrive out of order                                                     |

The fix:

1. Insert a `live_outbox` row (`topic`, `kind`, `entity_id`, `version`, `event`, `created_at`, `sent_at`) **inside the business transaction**, from the same triggers that write `*_events`, so no code path can forget it.
2. The relay publishes **after commit**:
   - Wake-up: `pg_notify` once per transaction, plus a 1 s sweep using `FOR UPDATE SKIP LOCKED`. pg-boss alone would add 0.5–2 s, since its polling defaults to 2 s with a 500 ms minimum.
   - Delivery is at-least-once.
   - Pings are idempotent: the client gate drops `v <= last`.
   - Pings are order-tolerant: each carries its version.
3. Sent rows are purged after 24 h. An alert fires if the oldest unsent row is older than 5 s.

This is the same pattern as `notification_outbox` (spec 10), and the relay runs in the same always-on worker that already runs pg-boss timers. **The same outbox feeds any transport**: RTDB, Redis/SSE, Supabase REST broadcast, or Ably. That is the seam.

### 4.5 Verdict

- **Pros:**
  - We already have the project.
  - Users already have Firebase sessions, so no third-party-auth setup.
  - About $0 up to well past 10 k daily users.
  - 200 k connections.
  - Excellent mobile SDKs plus FCM.
  - Bandwidth billing suits thin pings.
- **Cons:**
  - A relay hop.
  - Singapore region.
  - Security rules are a second (tiny) policy surface that needs emulator tests.
  - Google lock-in, already present through Firebase Auth.
  - Blaze needs a billing account. Production phone-OTP volume will probably need Blaze anyway; verify on the Auth quota page.

## 5. Managed and self-hosted pub/sub (brief)

| Service                                   | India / latency                                                                        | Free tier                                                            | Paid pricing                                                                                                                                              | Notes                                                                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ably**                                  | 15+ AWS datacentres and 700+ PoPs; Mumbai **not publicly listed** (ask)                | 6 M messages/month, 200 connections, 200 channels, 500 msg/s         | Standard $29/month + $2.50 per million messages (down to $0.50) + $1.00 per million connection-minutes (down to $0.20); each delivery counts              | Token auth with per-channel capabilities issued by our API: a good actor-scoped fit. Strong delivery guarantees, history and recovery                                    |
| **Pusher Channels**                       | **`ap2` = Mumbai cluster**                                                             | Sandbox: 100 connections, 200 k messages/day                         | Startup $49 (500 connections), Pro $99 (2,000), Business $299 (5,000), Premium $499 (10 k), Growth $699 (15 k); 1 publish to 50 subscribers = 51 messages | Simple private channels, authorised by an endpoint on our API. Pricing jumps in tiers by connections                                                                     |
| **PubNub**                                | Global edge; India PoP not stated                                                      | 200 MAU or 1 M transactions                                          | Starter **$98/month for 1,000 MAU**; MAU-priced                                                                                                           | MAU pricing punishes a marketplace where every signed-in customer connects. Poor fit                                                                                     |
| **Centrifugo** (self-hosted, Go)          | Wherever we run it (Mumbai)                                                            | Open source, Apache-2.0 (a PRO edition is commercial)                | Our infrastructure: one small VM plus Redis to start                                                                                                      | WebSocket, SSE, HTTP-streaming, gRPC. Redis/NATS brokers, history and **stream recovery**, connect/subscribe proxy to our API. The grown-up version of "own SSE"         |
| **Cloudflare Durable Objects / PartyKit** | Cloudflare has Indian PoPs, but each object runs in one location (use the `apac` hint) | Free plan: 100 k requests/day, 13 k GB-s/day (SQLite-backed objects) | $5/month minimum, 1 M requests included, then $0.15 per million; incoming WebSocket messages billed at 20:1; **hibernated idle sockets cost no duration** | Very cheap at scale, but it is a new runtime and vendor. Verify Firebase JWTs in the Worker (Google JWKS). PartyKit is now Cloudflare's `partyserver` on Durable Objects |

None of these beats RTDB on cost at our scale, and each adds a vendor, keys and a DPA. Ably and Pusher are the "buy" options if we ever outgrow RTDB and don't want to run Centrifugo.

## 6. Polling with ETag + the Page Visibility API (fallback and cost floor)

- **How it works.**
  - Live GETs return a weak `ETag` built from `max(version)` of the rows they cover. The client sends `If-None-Match`; an unchanged result returns `304` with an indexed lookup.
  - Poll only while `document.visibilityState === 'visible'`. Refetch at once on `visibilitychange → visible` and `online`.
  - Intervals: 15 s on portals with a live timer, 30–60 s elsewhere. Back off to 60 s after 5 unchanged polls.
- **Cheaper still:** poll one "topic version" endpoint backed by Redis (`GET live:ver:{topic}`, bumped by the relay). Fetch the real data only when it moved.
- **Latency:** interval/2 on average, so a 7.5 s mean and a 15 s worst case. That is not "instant", but it is acceptable for KPIs and moderation queues.
- **Load:** one visible portal tab at 15 s is 240 requests/hour. About 120 tabs × 8 h ≈ 230 k requests/day ≈ 7 M/month.
  - Cloud Run requests cost $0.40 per million, so about $3, plus small CPU.
  - Polling through Upstash pay-as-you-go would be about $14/month in commands, so use a Fixed plan or the DB path.
  - At 100 k daily users polling costs about 10× that, **more than any push option**. Push wins at scale.
- **Role:** always built, because it is the fallback when the push socket is down and the floor that works with zero vendors. The e2e suite still asserts **zero polling while push is healthy** (`realtime.md` §10).

## 7. Decision table

Assumptions:

- **Peak live connections** ≈ 12 % of daily users (shops, workshops and staff all day; customers only while something is in flight): 120 / 1.2 k / 12 k.
- **Live jobs per day** (orders + service requests) ≈ 10 % of daily users: 100 / 1 k / 10 k.
- **Pings:** 8 changes × about 5 recipients per job.
- Costs are **monthly, incremental, in USD**. They exclude the Supabase Pro base ($25), which we may pay anyway.

| Option                                | Commit → UI p50 | 1 k DAU                            | 10 k DAU                | 100 k DAU                          | Ops burden                                  | Mobile                               | Auth integration                                                       | Lock-in                       | Fit with outbox + thin ping         |
| ------------------------------------- | --------------- | ---------------------------------- | ----------------------- | ---------------------------------- | ------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------- | ----------------------------- | ----------------------------------- |
| Supabase Broadcast from DB            | ~100–300 ms     | $0 on Free (120 < 200 connections) | **Pro needed**; ≈ $10   | ≈ $150 + a raised connection limit | Low (managed, no relay)                     | supabase-js, foreground only         | Firebase third-party issuer + `role` claim; join cached per connection | Medium (Supabase)             | Native (trigger = outbox, no relay) |
| **Firebase RTDB inbox (recommended)** | ~150–350 ms     | **$0** (Blaze, inside free)        | **$0**                  | **≈ $5–10**                        | Low (managed) + relay we own                | **Best**: native SDKs + FCM          | Existing Firebase session; 1-line rule; membership resolved by us      | Medium (Google, already used) | Good (outbox relay)                 |
| Firestore listener inbox              | ~200–500 ms     | $0                                 | ≈ $1–2                  | ≈ $15–25 (+ reconnect re-reads)    | Low + relay                                 | Very good (offline machinery unused) | Same as RTDB                                                           | Medium                        | Good (relay)                        |
| Own SSE (Cloud Run + Upstash)         | ~50–200 ms      | ≈ $25–60 (1 instance)              | ≈ $60–120 (2 instances) | ≈ $300–450 (6 average, 15 at peak) | **High** (we own reconnect, drain, fan-out) | Weak (RN polyfill)                   | **Best**: our middleware, actor-derived topics, server-side kill       | **None**                      | Good (relay → Redis)                |
| Centrifugo on a VM                    | ~50–200 ms      | ≈ $15–25 (VM + Redis)              | ≈ $25–40                | ≈ $60–120 (2–3 nodes)              | Medium–high (we run it)                     | Good (official mobile SDKs)          | Good (connect/subscribe proxy to our API)                              | Low (OSS)                     | Good (relay → Centrifugo API)       |
| Ably                                  | ~50–150 ms      | $0 (free)                          | ≈ $55–60                | ≈ $150–450                         | Low                                         | Very good                            | Good (token capabilities from our API)                                 | High                          | Good (relay → REST)                 |
| Pusher Channels (Mumbai `ap2`)        | ~50–150 ms      | $0–49                              | $99                     | $699                               | Low                                         | Good                                 | Good (auth endpoint)                                                   | High                          | Good                                |
| PubNub                                | ~50–150 ms      | ≈ $98                              | Enterprise              | Enterprise                         | Low                                         | Good                                 | Good                                                                   | High                          | Good                                |
| Cloudflare Durable Objects            | ~50–200 ms      | $0–5                               | ≈ $5–15                 | ≈ $20–40                           | Medium (new runtime)                        | Fair (plain WebSocket)               | Fair (JWT check in the Worker)                                         | Medium                        | Good                                |
| Polling (ETag, visible tabs)          | 7.5 s avg       | ≈ $3–5                             | ≈ $30–50                | ≈ $300–500                         | Lowest                                      | Works everywhere                     | Our API                                                                | None                          | It _is_ the refetch                 |

Every cost figure is an estimate from list prices on 2026-11-01. Re-check before committing; the Cloud Run rows especially need the official calculator.

## 8. Recommendation

### 8.1 Now: Raipur, Supabase Free, small scale

1. **Build the seam (transport-agnostic):**
   - `live_outbox` plus triggers.
   - A relay in the existing pg-boss worker (NOTIFY wake-up + 1 s sweep).
   - `LivePublisher` on the server, and `LiveTransport` / `useLiveQuery` on the client (`realtime.md` §8).
   - The polling transport ships first, so the product works before any vendor is wired.
2. **Primary push transport: the Firebase RTDB inbox** on Blaze, in asia-southeast1.
   - Lazy-load `firebase/database` only on live pages, signed-in users only.
   - Set a budget alert and turn on App Check.
   - Add emulator-based rules tests that mirror the pgTAP matrix.
3. **Fallback: ETag polling** (15 → 30 → 60 s, visible tabs only).
4. **Don't build Supabase Broadcast or SSE yet.** If the owner moves to Supabase Pro before launch, Supabase Broadcast becomes equally reasonable. It would only remove the relay hop, though, and the RTDB path already works on any Supabase plan and on mobile, so don't run both.

### 8.2 At scale: multi-city, mobile app

- **Stay on RTDB while it fits.** That means 200 k connections and about 1,000 writes/s per database.
  - Shard by **one RTDB instance per city or region** before the write limit binds. The relay picks the instance from `city_id`.
  - The React Native app uses the same inbox, with FCM for background wake-ups.
- **Switch the adapter to own SSE or Centrifugo** (Mumbai, our infrastructure) if any of these happens:
  - (a) A DPDP or enterprise requirement keeps all signals in India.
  - (b) We want server-side instant revocation and per-connection telemetry for staff.
  - (c) We leave Firebase.
  - For a large fleet prefer **Centrifugo on 2–3 small VMs** over Cloud Run, because the 1,000-connection cap per instance and the always-billed instances make Cloud Run SSE the most expensive push option.
- **Buy instead of run: Ably** (token capabilities) or **Pusher `ap2`**, if we want a managed fleet with history and recovery and don't want Firebase.

### 8.3 Architecture sketch

```
 Customer / Shop / Staff action ──HTTPS (Firebase ID token)──► Hono API (Cloud Run, stateless)
                                                                  │ one transaction:
                                                                  │  conditional UPDATE (status, version)
                                                                  │  *_events + audit_log + notification_outbox
                                                                  │  live_outbox row(s)  ← trigger, same tx
                                                                  │  pg_notify('live')   ← once per tx (wake-up only)
                                                                  ▼
                                                        Supabase Postgres (Mumbai)
                                                                  │ COMMIT
                                ┌─────────────────────────────────┘ NOTIFY (commit-only) + 1 s sweep
                                ▼
                 pg-boss worker (always-on): live relay
                   1. claim rows FOR UPDATE SKIP LOCKED
                   2. resolve recipients from Postgres (user / shop members / city staff), actor rules
                   3. LivePublisher.publish(recipients|topic, ping{e,k,id,v,at})
                   4. mark sent_at; alert if oldest unsent > 5 s
                                │
          ┌─────────────────────┼──────────────────────────┬─────────────────────────┐
          ▼                     ▼                          ▼                         ▼
   RtdbPublisher (now)   RedisSsePublisher (Plan B)  SupabaseBroadcastPublisher   AblyPublisher
   Admin SDK → /inbox/   PUBLISH live:{topic} →      REST broadcast (if Pro)      REST (if bought)
   {uid}/{k}~{id}        mechdost-live SSE fleet
          │                     │
          ▼                     ▼
   Browser / RN app: LiveTransport → version gate → debounced refetch GET /v1/... (ETag/304)
   fallback: polling transport (visible tabs) · background mobile: FCM via notification_outbox
```

### 8.4 Transport adapter interface (sketch)

```ts
// packages/shared/src/realtime.ts (shared contract; already proposed in realtime.md §5.3)
export type LivePing = { e: string; k: LiveKind; id: string; v: number; at: string };

// apps/api/src/live/publisher.ts: server side, one implementation per transport
export interface LivePublisher {
  readonly name: 'rtdb' | 'redis-sse' | 'supabase' | 'ably' | 'noop';
  /** Recipients are resolved by the relay from Postgres; topic-based transports may ignore them. */
  publish(
    batch: ReadonlyArray<{ topic: Topic; recipients: ReadonlyArray<UserId>; ping: LivePing }>,
  ): Promise<void>;
}

// apps/web/src/lib/live/transport.ts: client side (realtime.md §8), one per transport
export interface LiveTransport {
  subscribe(scope: LiveScope, onPing: (p: LivePing) => void, onStatus: (s: LiveStatus) => void): () => void;
}
```

`LIVE_TRANSPORT=polling|rtdb|sse|supabase` selects the implementation through an env flag, and admin-visible health shows which one is active. One contract test suite runs against every adapter: payload keys exactly `{e,k,id,v,at}`, no PII, a version-gate round trip, and a role-leak check.

### 8.5 Migration path

| Step | Change                                                                                                                                            | Rollback                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 0    | Demo transport over `storage`/`BroadcastChannel` (already planned in `realtime.md` §12)                                                           | n/a                                      |
| 1    | `live_outbox` + triggers + relay + **polling transport** + ETag on live GETs                                                                      | Disable the relay; polling keeps working |
| 2    | `RtdbPublisher` + RTDB client transport behind `LIVE_TRANSPORT=rtdb`; rules + emulator tests; Blaze budget alert                                  | Flip the flag back to `polling`          |
| 3    | Mobile app: same inbox via `@react-native-firebase/database`; FCM for background                                                                  | Polling on foreground                    |
| 4    | (Scale) RTDB instance per city/region; split large `staff:city` topics into `/topics` + ACL                                                       | Single instance                          |
| 5    | (Optional) `RedisSsePublisher` + `mechdost-live` service or Centrifugo; run both transports in shadow for a week, comparing `realtime_latency_ms` | Flip the flag                            |

## 9. Risks

| Risk                                                                       | Mitigation                                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relay down → no pings                                                      | Clients fall back to polling. Alert when the oldest unsent `live_outbox` row is > 5 s old. Run the worker always-on, as the pg-boss timers already require    |
| `NOTIFY` global commit lock under heavy writes                             | One `pg_notify` per transaction, as a wake-up only. At high write rates drop it and use a 250 ms sweep                                                        |
| RTDB in Singapore: DPDP or latency concerns                                | Opaque uuids only, no PII, 24 h retention. Latency budget measured in the field. Escalate to the user if a ruling demands India-only                          |
| RTDB rules mistake leaks pings                                             | One-line `auth.uid === $uid` rule; emulator tests in CI; pings are thin and the refetch returns 404 for foreign ids                                           |
| Firebase bill surprise (denied reads are billed; budgets don't cap)        | App Check, budget alerts, a connection dashboard, and the per-entity overwrite shape that keeps downloads tiny                                                |
| RTDB soft limit of 1,000 writes/s, or `staff:city` fan-out growth          | Shard per city; `/topics` + ACL for big staff topics                                                                                                          |
| SSE (if adopted): Cloud Run cost, 60-min cuts, deploy stampedes            | A separate `live` service, 50–55 min jittered rotation, SIGTERM `reconnect` event, a leader tab per browser; Centrifugo/VM at scale                           |
| Upstash pub/sub delivery billing undocumented                              | Confirm with Upstash, or use a Fixed plan (no per-command billing)                                                                                            |
| Revocation window while a socket is open (RTDB/Supabase: ≤ token lifetime) | API enforcement is immediate (Q29 `authz:ver` bump); the relay stops sending to revoked users per send; SSE closes streams server-side                        |
| Two auth surfaces drift (API permissions vs transport rules)               | Membership is resolved only in the relay (Postgres); transport rules are identity-only (`uid`), never business logic                                          |
| Decision drift                                                             | This changes the 2026-10-31 stack line ("Realtime: Supabase"), so it needs a dated `decisions.md` entry, plus updates to specs 10, 13, 16 and 19 when adopted |

## Sources

- Supabase, Realtime limits (Free/Pro connections, msg/s, joins, payload, error codes): https://supabase.com/docs/guides/realtime/limits
- Supabase, Pricing (Realtime quotas; Free pauses after 1 week inactive): https://supabase.com/pricing
- Supabase, Manage Realtime Messages usage (send + per-recipient counting; Free has no overage): https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages
- Supabase troubleshooting, Realtime project suspended for exceeding quotas (grace period, review, Realtime disabled): https://supabase.com/docs/guides/troubleshooting/realtime-project-suspended-for-exceeding-quotas
- Supabase, Connect to your database (Supavisor session 5432 vs transaction 6543; IPv4/IPv6): https://supabase.com/docs/guides/database/connecting-to-postgres
- Google Cloud, Cloud Run request timeout (5 min default, 60 min max): https://docs.cloud.google.com/run/docs/configuring/request-timeout
- Google Cloud, WebSockets on Cloud Run (streams are requests, active-instance billing, 1,000 per container, best-effort affinity, Redis/Firestore for fan-out): https://docs.cloud.google.com/run/docs/triggering/websockets
- Google Cloud, Billing settings (request-based vs instance-based): https://docs.cloud.google.com/run/docs/configuring/billing-settings
- Google Cloud, CPU limits (< 1 vCPU ⇒ concurrency 1 and request-based billing): https://docs.cloud.google.com/run/docs/configuring/services/cpu
- Google Cloud, Concurrency (max 1,000): https://docs.cloud.google.com/run/docs/about-concurrency
- Google Cloud, Cloud Run pricing (verify asia-south1 tier and rates in the calculator): https://cloud.google.com/run/pricing
- Vercel, Functions limits (300 s Hobby, 800 s Pro, 1,800 s beta; memory billed for duration): https://vercel.com/docs/functions/limitations
- Upstash, Redis pricing (500 k free, $0.20 per 100 k, Fixed plans without command billing, 10 k cmd/s): https://upstash.com/pricing/redis and https://upstash.com/docs/redis/overall/pricing
- Upstash, Realtime pricing (commands per publish/subscribe operation): https://upstash.com/docs/realtime/overall/pricing
- PostgreSQL, NOTIFY (commit-only delivery, 8,000 B payload, 8 GB queue): https://www.postgresql.org/docs/current/sql-notify.html
- Recall.ai, "Postgres LISTEN/NOTIFY does not scale" (global commit lock; later fix noted): https://recall.ai/blog/postgres-listen-notify-does-not-scale
- pg-boss, Workers (polling default 2 s; 0.5 s minimum per source): https://timgit.github.io/pg-boss/api/workers
- MDN, Using server-sent events (`id`, `retry`, 6-connection HTTP/1.1 limit, HTTP/2 100 streams): https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- Firebase, Pricing (RTDB 100 vs 200 k connections, $1/GB, $5/GB; Firestore free quotas): https://firebase.google.com/pricing
- Firebase, RTDB limits (200 k per database, 1,000 writes/s, 100 k responses/s): https://firebase.google.com/docs/database/usage/limits
- Firebase, RTDB billing (layer-5 outbound bytes, 3.5 KB TLS handshake, denied ops billed, budgets don't cap): https://firebase.google.com/docs/database/usage/billing
- Firebase, RTDB locations (us-central1, europe-west1, asia-southeast1 only): https://firebase.google.com/docs/database/locations
- Firebase, Firestore locations (asia-south1 Mumbai, asia-south2 Delhi): https://firebase.google.com/docs/firestore/locations
- Firebase, Firestore pricing / billing (listener reads, 30-min reconnect re-query, 1-read minimum, rules reads): https://firebase.google.com/docs/firestore/pricing and https://cloud.google.com/firestore/pricing
- Firebase, Choose a database: RTDB vs Firestore (latency positioning): https://firebase.google.com/docs/database/rtdb-vs-firestore
- Firebase, Custom claims (rules use `auth.token`, 1,000-byte cap, refresh on new token): https://firebase.google.com/docs/auth/admin/custom-claims
- Ably, Pricing and "what counts as a message": https://ably.com/pricing and https://ably.com/docs/platform/pricing
- Ably, Edge network (15+ datacentres, unnamed): https://ably.com/docs/platform/architecture/edge-network
- Pusher, Channels pricing (tiers; 1 → 50 = 51 messages): https://pusher.com/channels/pricing/
- Pusher, Clusters (`ap2` Mumbai): https://pusher.com/docs/channels/miscellaneous/clusters/
- PubNub, Pricing (200 MAU free, Starter $98 for 1,000 MAU): https://www.pubnub.com/pricing/
- Centrifugo, Introduction (transports, brokers, recovery): https://centrifugal.dev/docs/getting-started/introduction ; licence: https://centrifugal.dev/license_2025_11_06
- Cloudflare, Durable Objects pricing (free plan, 20:1 WebSocket billing, hibernation): https://developers.cloudflare.com/durable-objects/platform/pricing/
- Third-party latency estimate (Mumbai–Singapore ≈ 60–75 ms RTT; treat as rough): https://www.techplained.com/india-cloud-latency
- Internal: `docs/research/realtime.md`, `docs/decisions.md` (2026-10-31 Stack; Supabase Free ruling), `docs/specs/10-notifications.md`, `docs/research/data-integrity.md` §8
