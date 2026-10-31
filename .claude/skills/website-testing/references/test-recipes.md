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

- Projects: `mobile` (390×844, WebKit), `tablet` (768), `desktop` (1440, Chromium); locales `en`, `hi`.
- Role fixtures with stored auth state per role (customer, shop, workshop, admin).
- Fail on console errors (hydration, CSP) via a fixture that collects `page.on('console')`.
- Accessibility: `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag22aa']).analyze()` → 0 serious/critical.
- Visual: `expect(page).toHaveScreenshot()` per key view; compare layout intent with `docs/screenshots/concept`.

## Lighthouse CI budgets (with apps/web)

`lighthouserc.json`: assert `largest-contentful-paint ≤ 2000`, `cumulative-layout-shift ≤ 0.05`,
`interaction-to-next-paint ≤ 200` (field/RUM), categories performance/accessibility/best-practices/seo ≥ 0.9.
