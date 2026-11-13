# Test recipes (copy and adapt; keep in sync with real helpers)

## DB test harness (exists)

```ts
import { createTestDb } from '@mechdost/db/testing';
const { db, client } = await createTestDb(); // migrations applied, PostGIS ready
// Expect a Postgres error code:
import { pgCode } from '@mechdost/db/repo';
await expect(p).rejects.toSatisfy((e) => pgCode(e) === '23505');
```

SQLSTATE cheat sheet: `23505` unique · `23514` check · `23503` FK · `23P01` exclusion · `23001` restrict (append-only trigger) · `40001` serialization.

## Property test (fast-check)

```ts
fc.assert(
  fc.property(
    fc.integer({ min: 0, max: 50_000_000 }),
    fc.constantFrom(0, 500, 1200, 1800, 2800),
    fc.boolean(),
    (gross, rate, inter) => {
      const r = splitInclusiveGst(gross, rate, inter);
      expect(r.taxable + r.cgst + r.sgst + r.igst).toBe(gross);
    },
  ),
);
```

## Clock manipulation (no sleeps)

Move deadlines with SQL instead of waiting:

```ts
await db.execute(
  sql`update order_assignments set offered_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where id = ${id}`,
);
```

For pure code inject `now: Date`; for Playwright use `page.clock.install({ time })`.

## Concurrency on real Postgres (run when TEST_DATABASE_URL is set)

```ts
const results = await Promise.allSettled(
  Array.from({ length: 20 }, () =>
    db.transaction((tx) => acceptAssignment(tx, { assignmentId, shopId, actor: { type: 'shop' } })),
  ),
);
expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
```

Use a pool with ≥ 20 connections; each attempt in its own transaction.

## Role-leak matrix (API)

```ts
const actors = { customerA, customerB, shopA, shopB, admin, cityManagerOtherCity };
for (const route of resourceRoutes)
  for (const [name, actor] of Object.entries(actors)) {
    const res = await app.request(route.path(ownerFixture), { headers: auth(actor) });
    expect(res.status, `${name} → ${route.name}`).toBe(route.allowed.includes(name) ? 200 : 404);
  }
```

## Webhook chaos (Razorpay)

- Sign the **raw** body: `createHmac('sha256', secret).update(raw).digest('hex')` → `X-Razorpay-Signature`.
- Replay the same `x-razorpay-event-id` 3× → one state change, one outbox row.
- Send `payment.captured` before the order exists → parked; run reconciliation → applied.
- Send `payment.failed` after `paid` → no-op. Tamper amount → `amount_mismatch` alert, not paid.
- Old secret during rotation window → accepted; random secret → 400.

## API tests with Hono

```ts
const res = await app.request('/v1/me', { headers: { Authorization: `Bearer ${token}` } });
expect(res.status).toBe(200);
```

Inject fakes through the app factory (token verifier, rate limiter, clock) — never call real Firebase in unit tests.

## Playwright conventions (with apps/web)

States walked: <worlds × theme × language × widths rendered> · <states not representable in demo → where covered>

- Role fixtures with stored auth state per role (customer, shop, workshop, admin).
- Fail on console errors (hydration, CSP) via a fixture that collects `page.on('console')`.
- Accessibility: `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag22aa']).analyze()` → 0 serious/critical.
- Visual: `expect(page).toHaveScreenshot()` per key view; compare layout intent with `docs/screenshots/concept`.

## Lighthouse CI budgets (with apps/web)

`lighthouserc.json`: assert `largest-contentful-paint ≤ 2000`, `cumulative-layout-shift ≤ 0.05`,
`interaction-to-next-paint ≤ 200` (field/RUM), categories performance/accessibility/best-practices/seo ≥ 0.9.

## World states for the state matrix (`e2e/state-matrix.spec.ts`, `e2e/fixtures/demo-world.ts`)

Seed once per context, before the first navigation. A per-key "if absent" guard would bring back keys the app
removed (cleared compare list):

```ts
await page.addInitScript(
  (seed: Record<string, string>) => {
    if (window.localStorage.getItem('e2e-seeded')) return;
    for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
    window.localStorage.setItem('e2e-seeded', '1');
  },
  Object.fromEntries(Object.entries(world.seed(now)).map(([k, v]) => [k, JSON.stringify(v)])),
);
```

- Sign in without the form: `mechdost-demo-session` = `[{ accountId: 'demo-customer', signedInAt }]` (ids:
  `demo-customer`, `demo-shop`, `demo-shop-2`, `demo-workshop`, `demo-admin`). Use the login UI only in auth tests.
- Theme: `mechdost-theme` = `light|dark` (plain string) with `test.use({ colorScheme: <the opposite> })`.
- Tickets: `mechdost-demo-support` = `{ tickets: [...] }` (an object). No tickets: `{ tickets: [] }`; a missing key
  gives the seeded WhatsApp ticket. Zero coins: one entry `{ accountId: 'demo-customer', delta: -250, ... }`.
- Order status = `stage` (1-5) + `shop` + `declined` + `rejection` + `cancellation` + `delivery`. Service request
  status = `stage` (0-5) + `proposal` + `declinedBy` + `cancellation`. Estimate, bill, payment, refund and out of
  stock cannot be seeded: test them in the API and unit suites.
- Deadlines: `await page.clock.install({ time: now })`, seed from the same `now`, then `page.clock.fastForward()`.
- Every world lists `mustShow` per route; `checkPage` asserts it before the layout checks (H19).
- Checks per page: sideways scroll ≤ 1 px · saved theme and language on `<html>` · fixed elements on screen after
  scrolling and not overlapping · no inner scroll box · counts consistent · no `pageerror`, console error or failed
  own-server request.
- Cross-role flows run in **one context** (demo data and the session share `localStorage`; contexts do not share
  it): switch role with the `signIn` / `signOut` helpers of `roles.spec.ts`, or rewrite the session key and reload.
  "Another tab" cases use a second page of the same context. Real buttons only, never the demo "advance" control.
- After each step assert the other roles' pages, the overview counts, and the event in `mechdost-demo-events`.
- Permutations: world × theme × language × viewport in full; every other dimension (cart, compare, consent, block,
  site config, ticket, order bucket) pairwise; a bug found in a combination becomes a named world.
