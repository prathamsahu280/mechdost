# 16 · Performance & scalability

Status: decided · Phase 1 · Budgets are CI gates (CLAUDE.md hard rule 7)

## Budgets

LCP < 2.0 s (mid-range Android, 4G), INP < 200 ms, CLS < 0.05, TTFB < 800 ms (India), product page JS < 180 KB gz, Lighthouse ≥ 90 (perf, a11y, best practices, SEO), API p95 < 150 ms for catalogue reads, < 400 ms for checkout place.

## Front end (Next.js)

Static shell + streaming (Partial Prerendering); ISR for product/workshop/content pages with on-demand revalidation; Server Components by default; dynamic import for MapLibre, Recharts, QR scanner; `next/image` with AVIF/WebP, exact `sizes`, LQIP/blurhash, `priority` only hero; self-hosted fonts via `next/font`; route-level code splitting; no barrel imports; React best-practices skill rules (no waterfalls, `Promise.all`, Suspense boundaries); PWA service worker (Serwist) caching shell + last catalogue; prefetch on viewport for product cards; bundle analyzer budget in CI; Vercel Speed Insights + web_vitals events.

### Client JS: how it is measured and what keeps it down (2026-11-03)

- **Measure:** `next build && next start --port 3100`, then `node apps/web/scripts/measure-js.mjs` — loads each key page in headless Chromium and sums the compressed size of the scripts the page's HTML names (its own JS). Scripts fetched later (route prefetch for links in view, lazy islands such as the map or the assistant panel) are reported separately and do not count. Exits 1 when a page is over 180 KB gz. For module-level detail: `next experimental-analyze --output` (`.next/diagnostics/analyze/data`).
- **Measured 2026-11-03** (page's own JS, gz): `/` 163.7 KB, `/shop` 172.4, product page 172.4, `/workshops` 178.9, `/cart` 172.9 (framework ≈ 123 KB of each). Before: 178.2 / 175.1 / 174.6 / 181.6 / 175.6.
- **Never import next-intl's navigation** (`next-intl/navigation`, `createNavigation`) — not even in a Server Component: Turbopack puts every client boundary a server module can reach into that layout's client chunks, so its client `Link` and the whole ICU formatter (≈ 12 KB gz) shipped on every page although only `getPathname` was called. Use `localePath()` (`apps/web/src/lib/locale-path.ts`) or `<LocalLink>`; ESLint `no-restricted-imports` enforces it.
- **Header islands read light modules:** the account link reads `demo/session-state.ts` (who is signed in), not `demo/session.ts` (password hashing, sign-in), which stays on the sign-in and account pages.
- Pages whose islands format messages on the client (`ClientMessages`: cart, checkout, finder, booking, reviews) pay for the formatter; others must not.

## Smoothness (user requirement: transitions, scrolls, navigation must feel really smooth)

- **Navigation**: Next.js `<Link>` prefetch on viewport/hover; View Transitions API (`experimental.viewTransition`) for route changes with shared-element transitions for product card → product page and workshop card → profile; instant back/forward via Router Cache; scroll restoration on back; sticky header with no jank (transform-based hide/show).
- **Feedback**: optimistic UI for add-to-cart, wishlist, accept/decline, approve-line; skeletons shaped like the final content (no spinners for < 300 ms, no flashing); toasts non-blocking.
- **Motion**: only `transform`/`opacity` animations; 150–250 ms ease-out for micro-interactions, 300–400 ms for panels; spring for drawers (Motion library, lazy-loaded); hover lift as in the concept; `prefers-reduced-motion` disables all non-essential motion; no scroll-jacking; `scroll-behavior: smooth` for in-page anchors only.
- **Scrolling**: passive listeners, `content-visibility: auto` for long lists, virtualised catalogue beyond 60 items, images with reserved aspect ratio (CLS < 0.05), no layout shift from fonts (`size-adjust`), bottom tab bar fixed with safe-area padding.
- **Measurement**: INP < 200 ms and long-task budget (< 50 ms tasks) in Lighthouse CI; Chrome DevTools MCP traces on key flows before each release; web_vitals events in analytics.

### Server-side data from the API (ruling 2026-11-10, catalogue)

- `fetch` caching is off by default in Next 16: every server fetch states `next: { revalidate, tags }`. Pages get ISR from those fetches (no page-level `revalidate`, which must be a literal and cannot follow the data switch).
- No build-time dependency on the API: dynamic product routes prerender nothing in api mode and render on first visit; a failed fetch throws so the last good page keeps serving.
- **Open (blocks `NEXT_PUBLIC_DATA_MODE=api` on deploys):** server-side calls reach the API from the web server's IP, so per-IP limits (`catalogue_ip` 240/min, global 600/min) would apply to all shoppers together. The fix must keep **per-shopper** limits (final review 2026-11-10: a single server-to-server bucket would let one client exhaust it for everyone by varying `?q=` or calling the "Load more" server function): the web forwards the shopper's IP in a header the API trusts only from the web (shared secret + trusted hop) and the API limits on that IP; the web also limits the "Load more" server function and uncached searches per IP.

## Images

Upload → sharp pipeline (EXIF strip, resize to 320/640/1600, AVIF+WebP, blurhash) → Supabase Storage → CDN (Cloudflare in front; Vercel image optimiser as fallback). Never serve originals. Lazy load below fold; reserve space.

## API & data (Hono + Postgres)

Stateless API containers (Cloud Run min 1, max N, concurrency 80, no long-lived connections on Cloud Run — live pings go through Firebase Realtime Database (one DB per region later, ~1k writes/s each)); Supavisor transaction pooling; Redis cache for catalogue lists (60 s, tag invalidation), permissions (60 s), settings/content (5 min); cursor pagination; indexes: (city, category, status), GIN trigram on search columns, GIST on geo, partial indexes for queues; `EXPLAIN` CI check on top 20 queries; read replica when reads > 70% CPU; `events` partitioned monthly with BRIN; heavy jobs (co-purchase, rollups, exports) in pg-boss workers deployed as a separate Cloud Run job/worker pool; rate limits at edge (Cloudflare) + app (Upstash). Startup guards (review 2026-11-11, C2/C3): production refuses `TRUSTED_PROXY_HOPS=0` (behind the load balancer every request would share one IP and one rate-limit bucket), and on Cloud Run (`K_SERVICE` set) the API refuses any `NODE_ENV` other than `production`.

## Scalability path (no rewrite)

1. Single region Mumbai, 1–3 API instances, Supabase Pro + PITR → ~5k orders/day.
2. Add read replica, Redis cluster, Meilisearch, ClickHouse for events, separate worker pool → ~50k orders/day, multi-city.
3. Multi-region read (Vercel edge + replica), queue sharding by city, hot-path services in Rust behind the same OpenAPI if ever needed.

## Observability

Sentry (web + API) with release tags; structured JSON logs (Cloud Logging); OpenTelemetry traces API → DB; alerts: error rate, p95, queue depth, webhook failures, payment mismatch, acceptance timer backlog.

**Built 2026-11-14 (decision "Monitoring", `runbooks/monitoring.md`):** Sentry EU, errors only (no tracing, no OpenTelemetry setup, no replay, no breadcrumbs), every event scrubbed (`@mechdost/shared/error-scrub`), release = deployed commit. API + worker: `@sentry/node` loaded by dynamic import only when `SENTRY_DSN` is set; 500s and `log('error')` lines (one per message per 10 min). Website server: `instrumentation.ts` `onRequestError` (`@sentry/node`, `serverExternalPackages`). Browser: `lib/error-reporting.ts` (two listeners + a queue in the page's JS) loads `@sentry/browser` (`lib/sentry-browser.ts`, its own 28.9 KB gz chunk) **only after the first error**, so error-free visits fetch nothing; max 10 reports per page. Browser source maps are built, uploaded and deleted inside the Deploy image build only when `SENTRY_AUTH_TOKEN` is set; `.map` files are never left in `.next/static`. OpenTelemetry traces and alert rules beyond Sentry's are still to do.

## Acceptance

Lighthouse CI on home/shop/product/workshop pages per PR; k6 load test (500 VU browse, 50 VU checkout) before launch; chaos test: Redis down → degraded but working; DB failover drill.

## Budget notes (2026-11-14)

- `NEXT_PUBLIC_DATA_MODE` and `NEXT_PUBLIC_AUTH_MODE` are always defined at build time (`next.config.ts` `env`, default `demo`), so the CI budget build inlines them like production does and drops the other mode's code. Mode-specific hooks are chosen at module level (`useCartPricing`).
- **Demo store split (2026-11-14):** quotes moved to `demo/quote-store.ts`, and applications, invites and reviews to `demo/partner-store.ts`. They share storage through `storeCore`. Turbopack keeps every export of a module, so cold code must live in its own module. Result in the demo build: `/shop` 180.0 → 176.2 KB, `/cart` 179.9 → 176.1, every page about −3.8 KB.
- **Sentry measured (2026-11-14, demo build with `NEXT_PUBLIC_SENTRY_DSN` set, `measure-js.mjs`):** `/` 161.2 KB, `/shop` 176.9, product page 174.1, `/compare` 156.3, `/workshops` 176.1, `/cart` 176.9, `/hi` 161.2 (page's own JS, gz). Against the earlier `/shop` 176.2 and `/cart` 176.1: **+0.7–0.8 KB** (error listeners, the error boundary's report, the DSN constant). The Sentry SDK chunk (28.9 KB gz) is not requested on load. Headroom on `/shop` and `/cart`: 3.1 KB.

## Budget note: bell and web push (2026-11-15)

- **The Firebase messaging library never loads on a page view.** `@firebase/messaging` is imported by one file, `lib/push/enable-push.ts`, and that file is only reached through `import('@/lib/push/enable-push')` inside the click handlers of "Turn on" and "Turn off". `apps/web/test/push-lazy.test.ts` proves it from the import graph (no `next build` needed): only that file mentions the package, no module imports it statically, the browser permission call exists only there, and the header shell imports no API or Firebase code.
- **The bell is two pieces.** `components/notices/bell.tsx` (in the header on every page) is a few hundred bytes: it reads the session already loaded by the account link and renders nothing for visitors and in the demo. For a signed-in person it loads `bell-controller` (feed polling, dropdown, API calls) as its own chunk with `next/dynamic` (`ssr: false`), with a 44 px placeholder so the header does not shift. The portal "refresh on new notice" hook (`use-notice-refresh`) is a tiny window-event listener and pulls in none of that.
- **Strings travel as props** (the header is a Server Component; same approach as the compare tray): about 0.5 KB gz of HTML per page for the bell labels, and no i18n runtime. The centre, preferences and card pages use `ClientMessages` for the `bell` namespace only.
- **The push worker is a static file** (`/firebase-messaging-sw.js`, no library, no precache, `Cache-Control: no-cache`), registered only after "Turn on". No full PWA: serwist adds a precache and update surface we do not need for push.
- **Network:** one `GET /v1/me/notifications?limit=10` per 15 s (partners, staff) or 60 s (customers) per visible tab, indexed `(user_id, created_at)`; hidden tabs do not poll; errors back off to 5 minutes. Not measured with `measure-js.mjs` (no build in this change): the budget run is queued with the next measured change; expected: homepage and product-page JS unchanged within noise (header shell only).

## Budget note: job photos (2026-11-15)

Pictures are re-encoded once at upload (WebP 1600 and 480 px) and served as-is: `next/image` runs `unoptimized` with fixed-size boxes (no CLS), lazy-loaded, from the API (`Cache-Control: private, max-age=300`). The panel, strip and gallery are `React.lazy` chunks loaded only on the workshop portal, the request page and the workshop page; nothing in the header, layout or shop pages imports them (a unit test asserts it). Upload cost sits in the API (sharp, two decodes at a time per instance), not in the browser.

## Budget incident 2026-11-15

The bell + push merge pushed `/shop`, `/cart` and `/workshops` over 180 KB gz (181.3). Root cause found by local A/B
builds: the header bell's module-level `next/dynamic` (+1.5 KB on every page) and unannotated module-level
`defineMachine(...)` calls in `@mechdost/shared/state`. Fixed with a plain `import()` for the bell chunk and
`/* @__PURE__ */` on every machine: `/shop` 179.4, `/cart` 179.6, `/workshops` 178.6. Rules: no `next/dynamic` in modules
the header/layout import; module-level factory calls in shared packages are marked pure; headroom is ~0.5 KB, so any
change to always-loaded code is measured with a local build (`node apps/web/scripts/measure-js.mjs`) before merge.

## Catalogue tier 2 (2026-11-15)

Recommendations are Server Components behind Suspense: no client JS added to the product page, and the cart uses a client-free card (the cart and /shop are at 179.6 of 180 KB gz). The cart-slug cookie mirror in `demo/store.ts` adds a few lines to every bundle that contains the store: **measure with `next build` before release** (not run here, Q141). The cart page now reads a cookie, so it renders per request (it is noindex). The suggestions call is cached 5 minutes (`max-age=300` on the API, `revalidate: 300` in the website's fetch) and times out after 2 s without failing the page. The co-purchase job is one set-based statement per night. Privacy, Notify me and the two admin panels are lazy chunks loaded only on their screens.

## Budget note: product photos, wishlist and cart sync (2026-11-15)

Product photos are rendered by a **Server Component** with `getImageProps` (a plain `<img>`, no client runtime); the heart is a lazy chunk behind `wishlist-lazy.tsx` and exists only in real sign-in builds (build-time constant); the cart sync is fetched by dynamic import from the header's cart pill only when signed in, and from the sign-in screen. Net eager cost in header/card/cart bundles: the wrapper (a few hundred bytes) plus one effect in the cart pill; the real numbers must be measured with a local build (`node apps/web/scripts/measure-js.mjs`) before merge (not run here: builds are not allowed on this branch's job). Only the first product-page photo is `preload`/high priority.

## Budget note: the live listener (2026-11-15)

`@firebase/database` (~30 KB gz) must never enter an initial bundle. `lib/live/live-hub.ts` is light (no Firebase) and is imported only by code that runs for signed-in users (`storefront-sync`, `use-notice-feed`); the heavy `live-listener.ts` is reached only by the hub's dynamic import and only when `AUTH_MODE` is firebase, the database URL is set and a consumer started. No header or layout module imports the hub, and no `next/dynamic` is used (budget incident above). Guard: `apps/web/test/live-lazy.test.ts`. The cart pill is unchanged. **Measure `/shop` and `/cart` with `node apps/web/scripts/measure-js.mjs` before merge** (not run here: no builds on this machine).

## Budget incident 2026-11-15 (afternoon): storefront merges

- After merging support tier 2, catalogue parts A and B, workshops tier 2 and the live listener: `/shop` 180.4 and
  `/cart` 182.6 KB gz (demo build, `measure-js.mjs`).
- Found with `next experimental-analyze --output` on `main` and on the merge, diffing the route's initial modules:
  the cart suggestions imported the full `ProductCard` (now `recommendations-cart.tsx` → `recommendations-core.tsx`,
  lean card only); the cart pill imported the session store for the sync (now a build-time switch + `import()` of
  `cart-sync-mount.tsx` after load); and build-time switches compared imported constants, which the minifier does not
  fold across modules (now `process.env.NEXT_PUBLIC_*` inline in the switch).
- Result: `/` 164.1, `/shop` 180.0, product 178.1, `/workshops` 179.0, `/cart` 179.9 KB gz; CI measured `/shop` 180.0
  as OVER (a few bytes above), so the bell's switch got the same inline-env fix: `/` 164.0, `/shop` 179.8, product
  177.9, `/workshops` 178.8, `/cart` 179.8 KB gz. **Headroom on `/shop` is 0.2 KB**; next: inline env in every remaining `AUTH_MODE`/`DATA_MODE` switch (bell, push, header) to win it back.
- Guards: `apps/web/test/cart-pill-lazy.test.ts`, `apps/web/test/storefront-next-tier.test.ts`.

## Budget incident 2026-11-16: one extra chunk on every page

- After the real-API QA fixes: `/shop` 180.4 and `/cart` 180.3 KB gz, every page one script more than at `16a693c`
  (179.9 / 179.8). The modules themselves grew by 81 bytes; Turbopack split the lazy-import loader stubs into a
  chunk of their own (342 B gz).
- Found by building `16a693c` in a worktree and bisecting the merge file by file. Two new import edges each caused
  the split on their own: `lib/service-views.ts` importing `@mechdost/shared/time` (the past-hours helper), and a new
  module `lib/avatar-mark.ts` imported by the header's account link. Neither alone fixed it, which hid the cause.
- Fix: `hourHasStarted` uses `Intl` beside `istDate` in `service-views.ts`; `avatarMark` lives in
  `demo/session-state.ts` (already in the header bundle). Result back to `/` 164.1, `/shop` 179.9, `/cart` 179.8 KB gz.
- Lesson: on this graph a new import edge into the layout or home graph can cost a whole chunk; measure with
  `measure-js.mjs` before merging any change that adds a module or an import to code reachable from the layout or
  home, and compare the chunk count, not only the size. Guards: `apps/web/test/bugfix-qa-pass2.test.ts`
  (first-load chunk guards).

## Budget incident 2026-11-16 (night): feature merges

After merging the logo, closable panels, refunds, quotes, coupons and shop staff work, `/shop` measured 185.7, product
183.9, `/workshops` 184.6, `/cart` 185.6 KB gz (budget 180). Causes and fixes:

- The header logo used `next/image`, which pulled its client code (~5.5 KB gz) into every page without another
  image. Fixed with a plain `<img>` for the vector logo (decisions 2026-11-16; guard `test/brand-assets.test.ts`).
- `PanelDismiss` (Escape closes panels, mounted on every page) imported its logic statically (~0.6 KB gz). Fixed: the
  logic lives in `lib/panel-dismiss-runtime.ts`, loaded on the first opener click or Escape (guard
  `test/panel-dismiss.test.ts`).

After: `/` 164.0, `/shop` 179.9, product 178.1, `/workshops` 178.9, `/cart` 179.8, compare 159.2 KB gz. **`/shop` has
0.1 KB of room**: the next addition to the shop first load needs a matching cut (candidates: lazy compare tray code,
the filter sheet).

## Budget incident 2026-11-22: audience pages, loader-stub chunk again

- After the `/business/garages` and `/business/fleets` pages, Turbopack again split the lazy-import loader stubs into
  a chunk of their own on every page (demo build: `/shop` 180.8 KB gz in 15 chunks, `/cart` 180.7 in 13). The new
  routes themselves are the trigger (reverting the header link alone left `/shop` at 180.4), so the fix is real
  headroom, not avoiding the trigger.
- **Win 1, precompiled messages (about 8.7 KB gz on `/shop` and `/cart`).** `createNextIntlPlugin` now sets
  `experimental.messages.precompile` for `packages/shared/src/i18n`: the locale JSON is compiled to a compact form at
  build time and `use-intl` uses its format-only runtime, so `@formatjs/icu-messageformat-parser` (5.3 KB), the
  skeleton parser (2 KB) and most of `intl-messageformat` (1.9 KB) leave every client bundle that formats a message.
  Consequences to keep in mind: (a) every message must be valid ICU, so the WhatsApp texts (`{{1}}` is Meta syntax)
  moved to `packages/shared/src/notify-templates/{en,hi}.json` (read by `whatsapp-meta.ts` and the admin card); (b) `t.raw()`
  and direct imports of the locale JSON return compiled messages, not strings: the demo labour promise passes
  `{days: '{days}'}` to `t()` instead of `raw`, and the policy editor's "start from the built-in text"
  (`lib/policy-view.ts`) turns compiled arguments back into `{name}`; the root error copy is plain text only.
- **Win 2, Hindi product text out of the first load (about 1.9 KB gz on `/shop`).** The demo shop's in-browser search
  needs `PRODUCT_HI`, but only after the page is up: `searchProducts` takes it as an option and `shop-browser.tsx`
  fetches `demo/i18n/hi-products` with `import()` on mount (Hindi queries match as soon as the chunk arrives, in
  practice before the first keystroke).
- Result (demo build, `measure-js.mjs`): `/` 164.9 (unchanged), `/shop` 180.8 to 170.2 (15 to 14 chunks), product page
  179.0 to 170.4, `/workshops` to 171.4, `/cart` 180.7 to 172.2 (13), compare 160.1, `/hi` 164.9. Every page that
  formats messages in the browser has 8 KB or more of room.
- Guard: `apps/web/test/budget-2026-11-22.test.ts`. Not run here: the Playwright suites (e2e, hindi-coverage).

## Budget incident 2026-11-22: cold renders (6 to 11.5 s, 36 s under a 6-way crawl)

Reported on the live site (real API mode): warm pages 0.3 to 1.2 s, but the first uncached render of `/hi/shop` took
10 to 11.5 s, a Castrol product page 10 s, `/hi/business/garages` about 6 s, and single product pages up to 36 s under
a 6-way parallel crawl.

**Measured (read-only, GET only, at most 2 in parallel, from outside the server; compressed like a browser):**

| Layer                                                 | Result                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| API list / product / categories / suggest / recommend | 0.11 to 0.24 s warm, first calls 0.24 to 0.37 s (includes TLS); `Cache-Control: public, max-age=30`                 |
| Database, 242 live products                           | `EXPLAIN (ANALYZE, BUFFERS)` of the list query: execution 4.4 ms, planning 3.3 ms, all buffers hit, no big seq scan |
| `listCatalogue` / `getCatalogueProduct` wall time     | 114 to 366 ms from a PC (about 28 ms per round trip); the time is round trips, not plans                            |
| New database connection (TLS + SCRAM)                 | 450 to 510 ms from a PC; the pool drops connections after 20 idle seconds                                           |
| Web, never-rendered route (`X-Nextjs-Cache: MISS`)    | 0.24 to 0.27 s total; `/hi/shop` with unseen filters 0.25 to 0.55 s; product pages `STALE` served in 0.2 to 0.3 s   |
| Web, uncompressed download of the 760 KB shop HTML    | 0.9 to 5.6 s on the same page (transfer variance, not the server); compressed it is 87 KB and 0.3 s                 |

So at idle nothing is slow: the 6 to 36 s are not a slow query, a missing index or a slow API. **No migration 0081 was
needed or written** (nothing to index: 242 products, execution 4 ms). The slow renders happen on a **cold or loaded
web container** (512 MB, shared host: `docker stats` / instance type are queued as Q214) and have these code-level
contributors, all of which are cheap to remove:

1. **Every deploy empties the page cache.** ISR output lives in the web container's file system, so after each deploy
   the first visit to every shop and product page is a full render (API calls plus React render of up to 700 KB of
   HTML and flight data) and a crawler meets all of them at once. Fix: `apps/web/scripts/warm-cache.mjs` runs as the
   last deploy step, reads `sitemap.xml` and visits each page once, GET only, one page a second (about 180 API calls a
   minute, under the 240/min per-address limit), at most 8 minutes, never fails the deploy. Pages are served
   stale-while-revalidate afterwards, so warmed pages stay fast.
2. **Cold database connections.** `idle_timeout` is 20 s, so after any quiet period the next request paid a new TLS +
   SCRAM handshake (about 0.5 s from outside, less in the region). Fix: `keepPoolWarm` (packages/db) opens two
   connections at boot and pings them every 15 s from the API; four tiny queries a minute.
3. **Sequential database round trips on the product page.** `getCatalogueProduct` ran place, product, variants,
   photos and part numbers one after the other (5 round trips). Now the place lookup runs with the product query, and
   variants, photos and part numbers run together (3 round trips). Same SQL, same results (catalogue tests green).
4. **One rate-limit bucket for all server-side renders** (a risk, not yet proven in the logs): the website server calls
   the API by its public address, so every render shares one 240/min bucket; a cold crawl can get 429s that surface
   as error pages. Queued as Q215; the warm-up is paced to stay inside it.

Known and left alone (no measured cost at idle): the product page fetches the product, then the related list (one
cached call; a waterfall of one); `ranked` computes each product's offer before the page is cut (4.4 ms at 242 products,
revisit past about 5,000 products: cut the page first for `newest`); the shop HTML carries each card twice (HTML plus
flight data, 87 KB compressed); page and fetch revalidate stay at 30 to 60 s because there is no tag refresh on
price, stock or shop-status changes yet (a longer window needs that wiring and a decision first).

**Diagnostic kept:** `packages/db/scripts/explain-catalogue.ts` (`pnpm --filter @mechdost/db exec tsx
scripts/explain-catalogue.ts [--plans]`, `ENV_FILE=…` for another `.env`) times the storefront queries and prints
their plans; SELECT only, never prints the database URL.

Tests: `packages/db/test/keep-pool-warm.test.ts`, `apps/web/test/warm-cache.test.ts`, the existing
`packages/db/test/catalogue*.test.ts` (78) for the query change, `apps/web/test/catalogue-api-source.test.ts` (cache
revalidate and tags). Not measured here: a production "after" (nothing was deployed); after the next deploy, repeat
`curl -w` on `/hi/shop`, a product page and `/hi/business/garages` right after the warm-up step finishes.

## Photo byte cache (2026-11-24)

`GET /v1/product-photos/{id}/{width}` keeps the bytes of approved photos in an in-process LRU (`apps/api/src/photos/byte-cache.ts`, `PHOTO_CACHE_MB`, default 64, max 128, 0 = off) so repeat views and crawlers do not cost Supabase egress (free plan about 5 GB/month). Browsers already cache a year (`immutable`); this covers new visitors. Rules: approved photos only; no previews, no errors; evicted on remove/reject; hit and miss return identical bytes and headers; any cache failure falls back to Storage. A hit/miss summary line (`photo_cache`) is logged every 500 lookups. **Memory math:** WebP variants are about 10 to 40 KB (320), 30 to 90 KB (640), 100 to 300 KB (1600); 64 MB holds roughly 600 to 2,000 photos. Buffers live outside the V8 heap, so the cost is RSS: Node baseline about 150 to 200 MB + 64 MB cache + request buffers (uploads up to 8 MB, a few at once) stays under the new `mem_limit: 448m` (was 384m). The other containers have their own limits: web 512m, redis 96m, srh 160m, caddy 128m, worker 256m; check `docker stats` and `free -h` after deploy and set `PHOTO_CACHE_MB=32` if the host is short.

## Budget note: shopping personalisation phases 2 and 3 (2026-11-26)

Every personal piece is lazy or server-rendered: pages import only `RecentlyViewedLazy` (React.lazy); the list, its
storage, the signed-in sync and the suggestion tracker are one chunk loaded after hydration; cards come from the
`recentCards` server action; "Similar options" is a Server Component; the shop's Back restore is `import()`ed after
mount (`lib/list-place-runtime.ts`). Demo build, `measure-js.mjs` (one build, port 3147): `/` 169.8, `/shop` 179.3,
product pages 179.0 (castrol and tyre), `/cart` 178.6, `/workshops` 176.1, compare 164.2, `/hi` 169.8 KB gz, all
under 180. Before (lead's figures for main at 05228a49): `/shop` ~178.6, product ~178.4. So `/shop` +0.7 and product
+0.6 KB (the lazy wrapper, the restore effect and a chunk-split stub). **Headroom now 0.7 KB on `/shop` and 1.0 KB on
product pages.** Guard: `apps/web/test/personalisation.test.ts`.
