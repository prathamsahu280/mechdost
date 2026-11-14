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

## Acceptance

Lighthouse CI on home/shop/product/workshop pages per PR; k6 load test (500 VU browse, 50 VU checkout) before launch; chaos test: Redis down → degraded but working; DB failover drill.

## Budget notes (2026-11-14)

- `NEXT_PUBLIC_DATA_MODE` and `NEXT_PUBLIC_AUTH_MODE` are always defined at build time (`next.config.ts` `env`, default `demo`), so the CI budget build inlines them like production does and drops the other mode's code. Mode-specific hooks are chosen at module level (`useCartPricing`).
- **Headroom is gone** on `/shop` (180.0) and `/cart` (179.9) in the demo build. The next change on these pages must first make room. The best candidate is splitting `apps/web/src/demo/store.ts`: one ~9.8 KB chunk on every page that also carries quotes, requests, applications and invites.
