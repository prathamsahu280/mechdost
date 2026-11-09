# Catalogue + search on the API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web shop listing, search and product pages read the real catalogue API when `NEXT_PUBLIC_DATA_MODE=api`, and keep today's demo data when it is `demo` (default).

**Architecture:** Catalogue response DTOs move to `@mechdost/shared/catalogue` (one source for API and web). The web gets one view model (`CardView`, `ProductView`) with two sources: the demo mapper (today's data) and a server-only API source (`fetch` with `revalidate` + tags, 3 s timeout, Zod-parsed, throws on failure so ISR keeps the last good page). Components render the view model only.

**Tech Stack:** Next.js 16.4.5 App Router (no `cacheComponents`), next-intl, Hono + `@hono/zod-openapi` 1.6.3, zod 4.6.7 (one instance), Vitest, Playwright.

**Spec:** `docs/specs/02-catalogue-search.md` (API "Built 2026-11-03", Rules, Edge cases, Analytics); advisor brief 2026-11-10 (in `docs/progress.md`).

## Global Constraints

- Switch: `NEXT_PUBLIC_DATA_MODE` = `api` | `demo`; anything else = `demo` (Q70 default). Cart and checkout stay on demo data in this plan; the switch is not turned on for any deploy until they move too.
- No build-time dependency on the API: in api mode `generateStaticParams` returns `[]`, `dynamicParams = true`, `revalidate = 60`.
- Fetch: `{ next: { revalidate: 60, tags: ['catalogue', 'product:<slug>'] } }` (product), `{ next: { revalidate: 30, tags: ['catalogue'] } }` (listing); `AbortSignal.timeout(3000)`; non-2xx except 404 → throw; 404 → `null`.
- Always send `locale` (`en`|`hi`) and `city` (`RPR` until the city selector exists, spec 15) to the API.
- Search query trimmed and capped at 120 characters (`CATALOGUE_QUERY_MAX` in the API is the source).
- Page size 24 (API max 48); "Load more" with the opaque `nextCursor`.
- No new dependencies. Budgets (spec 16): product page JS < 180 KB gz; `/shop` must not grow above today's 172.2 KB.
- Hindi: `/hi` pages in api mode pass `e2e/hindi-coverage.spec.ts`.
- Analytics events unchanged in both modes: `view_item_list`, `select_item`, `view_item`, `search`, `filter_applied`.
- No 2W/4W fit in api mode (vehicle master pending #4): the card shows the neutral "Check fitment" text (spec 02 edge case).
- Product page in api mode shows the seller name and country of origin (E-Commerce Rules, spec 02).

## Review Focus

1. API down or slow on a first visit → the shop shows the concept's retry copy (error boundary), never "no products"; an already-rendered product page keeps serving (test: API source throws on 500/timeout; e2e: listing error boundary with the API stopped).
2. Unknown, draft or archived slug → 404 page, not 500 (test: API source returns `null` on 404; page calls `notFound()`).
3. A live product with no buyable offer → "On request", no price, no add-to-cart (test: `toCardView` with `offer: null`).
4. `/hi` in api mode → Hindi names from the API with English fallback; nothing English beyond the allowlist (e2e hindi-coverage in api mode).
5. Tampered `cursor` in the URL → first page, not a crash (API answers 422 `INVALID_CURSOR`; the source retries without the cursor).

---

### Task 1: Shared catalogue DTOs

**Files:**

- Create: `packages/shared/src/catalogue.ts`; Modify: `packages/shared/package.json` (export `./catalogue`)
- Modify: `apps/api/src/routes/catalogue.ts` (import the schemas, keep `.openapi('<Name>')` names)
- Test: `packages/shared/test/catalogue.test.ts`

**Interfaces:**

- Produces: `CatalogueOfferSchema`, `CataloguePhotoSchema`, `CataloguePlaceSchema`, `CatalogueCardSchema`, `CataloguePageSchema`, `CatalogueProductSchema`, `CatalogueCategorySchema` (plain zod, same fields as today's API) and types `CatalogueCard`, `CataloguePage`, `CatalogueProduct`, `CatalogueCategory` (`z.infer`); `CATALOGUE_LOCALES = ['en','hi'] as const`.

- [ ] **Step 1: Failing test** `catalogue DTOs parse a real API page and reject a card without slug` — parse a fixture page (one card with offer, one with `offer: null`, `nextCursor: null`); `expect(() => CatalogueCardSchema.parse({...card, slug: undefined})).toThrow()`.
- [ ] **Step 2:** `pnpm --filter @mechdost/shared exec vitest run test/catalogue.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Move the schemas; the API imports `@hono/zod-openapi` before `@mechdost/shared/catalogue` (its import patches zod's prototype, so `.openapi()` works on the shared schemas).
- [ ] **Step 4:** shared test PASS; `pnpm --filter @mechdost/api exec vitest run test/catalogue.test.ts` PASS (contract unchanged).
- [ ] **Step 5:** Commit `refactor(shared): catalogue DTOs shared by API and web`.

### Task 2: Data mode, view model, demo source; components on the view model

**Files:**

- Create: `apps/web/src/lib/data-mode.ts`, `apps/web/src/lib/catalogue/view.ts`, `apps/web/src/lib/catalogue/demo-source.ts`
- Modify: `components/catalogue/product-card.tsx`, `product-info-button.tsx`, `product-visual.tsx` (category key may be null → generic artwork), `components/catalogue/shop-browser.tsx` (cards keyed by slug unchanged), `app/[locale]/shop/page.tsx`, `app/[locale]/shop/[slug]/page.tsx`, `components/home/product-range.tsx`
- Test: `apps/web/test/catalogue-view.test.ts`

**Interfaces:**

- Produces: `DATA_MODE: 'api' | 'demo'` (from `data-mode.ts`).
- `interface CardView { slug: string; sku: string | null; brand: string; name: string; category: { key: CategoryKey | null; slug: string; name: string | null }; spec: string | null; fit: string | null; price: { pricePaise: number; mrpPaise: number | null } | null; availability: 'in_stock' | 'low_stock' | 'on_request'; leadDays: number | null; highlights: string[]; rating: { avg: number; count: number } | null; popular: boolean; photo: CataloguePhoto | null }`
- `interface ProductView extends CardView { description: string | null; compatibility: string | null; specRows: { label: string; value: string }[]; seller: string | null; countryOfOrigin: string | null; partNumbers: { kind: string; value: string }[]; shippingPaise: number | null }`
- `demoCard(p: DemoProduct, locale: Locale): CardView`, `demoProduct(p: DemoProduct, locale: Locale): ProductView` (category `name: null` → the card translates `key`).

- [ ] **Step 1: Failing tests** — `demoCard maps price, MRP, fit and rating`: Castrol slug → `price.pricePaise 44000`, `mrpPaise 47500`, `fit '2W'`, `rating` equals `productRating`; `demoCard in Hindi uses PRODUCT_HI`; `DATA_MODE is demo unless the env says api`.
- [ ] **Step 2:** `pnpm --filter @mechdost/web exec vitest run test/catalogue-view.test.ts` → FAIL.
- [ ] **Step 3:** Implement; components take `CardView`/`ProductView`; card shows `fit ?? t('checkFitment')`, rating row only when `rating` is non-null, price block only when `price` is non-null. New copy keys `catalogue.checkFitment` (en "Check fitment", hi "फ़िटमेंट जाँचें"), `catalogue.soldBy`, `catalogue.origin` in both locale files. Accessibility lead review before the component edits (hook).
- [ ] **Step 4:** unit PASS; demo e2e unchanged: `pnpm exec playwright test e2e/shop.spec.ts e2e/hindi-coverage.spec.ts --workers=1` (apps/web) PASS; `pnpm --filter @mechdost/web build` and budgets equal to before.
- [ ] **Step 5:** Commit `refactor(web): catalogue view model; demo source behind it`.

### Task 3: API source (server-only)

**Files:**

- Create: `apps/web/src/lib/catalogue/api-source.ts`
- Test: `apps/web/test/catalogue-api-source.test.ts`

**Interfaces:**

- Consumes: Task 1 schemas, Task 2 `CardView`/`ProductView`.
- Produces: `fetchCataloguePage(q: { locale: Locale; q?: string; category?: string; sort?: 'relevance' | 'newest' | 'price_asc' | 'price_desc'; cursor?: string; limit?: number }): Promise<{ items: CardView[]; nextCursor: string | null }>`; `fetchCatalogueProduct(slug: string, locale: Locale): Promise<ProductView | null>`; `apiCard(c: CatalogueCard): CardView`; `apiProduct(p: CatalogueProduct): ProductView`. Base URL `process.env.NEXT_PUBLIC_API_URL` + `/v1/catalogue/...`. Server-only by placement: imported only from Server Components and `actions.ts` (no `server-only` package; no new dependencies).

- [ ] **Step 1: Failing tests** (stub `globalThis.fetch`): `sends locale, city RPR, q trimmed to 120 and limit 24`; `passes revalidate and the catalogue tag`; `404 → null`; `500 → throws`; `timeout → throws` (fetch rejects with `TimeoutError`); `422 INVALID_CURSOR → retries once without the cursor`; `apiCard: offer null → price null, availability on_request, fit null`; `apiProduct: seller and country of origin from the first variant with an offer`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement. Map API `sort` from the web's `popular` → `newest` (API has no popularity yet).
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** Commit `feat(web): catalogue API source (server-only, cached, parsed)`.

### Task 4: Product page and shop listing in api mode

**Files:**

- Modify: `app/[locale]/shop/[slug]/page.tsx`, `app/[locale]/shop/page.tsx`, `components/catalogue/shop-browser.tsx`
- Create: `app/[locale]/shop/error.tsx` (client; concept retry copy `catalogue.loadFailed` + "Try again" → `reset()`), `components/catalogue/load-more.tsx`
- Test: `apps/web/e2e/catalogue-api.spec.ts`

**Interfaces:**

- Consumes: Task 2 `DATA_MODE`, `demoCard`, `demoProduct`; Task 3 `fetchCataloguePage`, `fetchCatalogueProduct`.
- Produces: product page `generateStaticParams()` → demo: today's list; api: `[]`; `export const dynamicParams = true; export const revalidate = 60`. `interface ListingQuery { locale: Locale; q: string; category: string | null; sort: SortKey }`; `loadMoreCards` (Step 3). ShopBrowser prop `mode: 'instant' | 'server'`: `server` submits filters with `router.replace(url, { scroll: false })` and keeps keyboard focus on the control that changed.

- [ ] **Step 1: Failing e2e** (skipped unless `E2E_DATA_MODE=api`; needs API + `pnpm db:seed:demo`): `listing shows API cards with prices for Raipur`; `search "castrl" finds Castrol` (spec 02 acceptance); `category filter keeps the URL shareable`; `load more appends the next page`; `product page shows seller and country of origin`; `unknown slug → 404 page`; `/hi/shop shows Hindi names`; `API down → retry copy` (runs only with `E2E_API_DOWN=1`: Playwright cannot intercept server-side fetches, so this run starts the web with the API stopped; steps in `docs/runbooks/demo.md`).
- [ ] **Step 2:** run in api mode → FAIL.
- [ ] **Step 3:** Implement both pages: api mode fetches on the server; listing reads `q`, `category`, `sort` from `searchParams` and renders page 1. "Load more" calls the server function `loadMoreCards(query: ListingQuery, cursor: string): Promise<{ cards: ReactNode; nextCursor: string | null }>` (`app/[locale]/shop/actions.ts`, `'use server'`, re-validates `query` like the page) which returns server-rendered `ProductCard`s, so no catalogue code or zod reaches the browser; `LoadMore` appends them, moves focus to the first new card and announces "N more products" in a polite status.
- [ ] **Step 4:** api e2e PASS; demo `shop.spec.ts` PASS; hindi-coverage PASS in both modes; `pnpm --filter @mechdost/web build` in each mode; budgets measured.
- [ ] **Step 5:** Commit `feat(web): shop listing and product pages on the catalogue API (data switch)`.

### Task 5: Docs and runbook

**Files:** `docs/specs/02-catalogue-search.md` (web wiring section), `docs/specs/16-performance-scalability.md` (fetch caching + no build-time API), `docs/decisions.md` (dated entry: data switch, no build-time API, view model), `.env.example` (`NEXT_PUBLIC_DATA_MODE`), `docs/runbooks/demo.md` (api-mode local run + e2e), `docs/progress.md`, learnings.

- [ ] **Step 1:** Update; `pnpm format:check` PASS.
- [ ] **Step 2:** Full gates `pnpm exec turbo run typecheck lint test --concurrency=1`; website-testing; code review; commit `docs: catalogue on the API`.
