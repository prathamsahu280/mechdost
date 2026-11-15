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
- Result: `/` 164.1, `/shop` 180.0, product 178.1, `/workshops` 179.0, `/cart` 179.9 KB gz. **Headroom on `/shop` is
  zero**; next: inline env in every remaining `AUTH_MODE`/`DATA_MODE` switch (bell, push, header) to win it back.
- Guards: `apps/web/test/cart-pill-lazy.test.ts`, `apps/web/test/storefront-next-tier.test.ts`.
