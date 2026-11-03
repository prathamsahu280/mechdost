/**
 * Event ingestion (spec 12): the shared registry decides what is stored; unknown events, invalid props and extra
 * fields (e.g. a phone number) are dropped; nothing without analytics consent; stale client clocks are clamped.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { events } from '@mechdost/db/repo';
import { EVENTS_PER_BATCH, EVENTS_RATE, EVENTS_ROWS_RATE } from '../src/routes/events';
import { MemoryRateLimiter } from '../src/rate-limit/limiter';
import { buildApp } from './helpers';

const post = async (ctx: Awaited<ReturnType<typeof buildApp>>, body: unknown) =>
  ctx.app.request('/v1/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /v1/events', () => {
  it('stores valid events and drops unknown, invalid or over-sharing ones', async () => {
    const ctx = await buildApp();
    const anonymousId = randomUUID();
    const now = new Date().toISOString();
    const res = await post(ctx, {
      source: 'web',
      anonymousId,
      sessionId: 'session-0001',
      consent: { analytics: true, version: '2026-11' },
      events: [
        { event: 'page_view', occurredAt: now, page: '/hi/shop', props: { path: '/hi/shop', locale: 'hi' } },
        {
          event: 'add_to_cart',
          occurredAt: '2020-01-01T00:00:00Z',
          props: { slug: 'castrol-activ', qty: 2 },
        },
        { event: 'made_up_event', occurredAt: now, props: {} },
        { event: 'add_to_cart', occurredAt: now, props: { slug: 'x', qty: 500 } },
        { event: 'click', occurredAt: now, props: { id: 'buy', path: '/shop', phone: '+919876543210' } },
        { event: 'search', occurredAt: now, props: { query: 'exide 98111 22222 me@x.in', source: 'header' } },
      ],
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ stored: 3, rejected: 3 });
    const rows = (await ctx.db.select().from(events)).filter((r) => r.anonymousId === anonymousId);
    expect(rows.map((r) => r.event).sort()).toEqual(['add_to_cart', 'page_view', 'search']);
    expect(rows.find((r) => r.event === 'search')!.props).toEqual({ query: 'exide # #', source: 'header' });
    expect(rows.every((r) => r.source === 'web' && r.consentVersion === '2026-11')).toBe(true);
    const cart = rows.find((r) => r.event === 'add_to_cart')!;
    expect(Date.now() - cart.occurredAt.getTime()).toBeLessThan(60_000); // 2020 clamped to the receive time
    expect(JSON.stringify(rows)).not.toMatch(/9876543210|98111|me@x/);
  });

  it('stores nothing without consent and validates the batch', async () => {
    const ctx = await buildApp();
    const anonymousId = randomUUID();
    const one = {
      event: 'page_view',
      occurredAt: new Date().toISOString(),
      props: { path: '/', locale: 'en' },
    };
    const res = await post(ctx, {
      source: 'web',
      anonymousId,
      consent: { analytics: false, version: '2026-11' },
      events: [one],
    });
    expect(await res.json()).toEqual({ stored: 0, rejected: 0 });
    expect((await ctx.db.select().from(events)).filter((r) => r.anonymousId === anonymousId)).toEqual([]);
    const tooMany = await post(ctx, {
      source: 'web',
      anonymousId,
      consent: { analytics: true, version: '2026-11' },
      events: Array.from({ length: 26 }, () => one),
    });
    expect(tooMany.status).toBe(400);
    expect(
      (
        await post(ctx, {
          source: 'web',
          anonymousId: 'not-a-uuid',
          consent: { analytics: true, version: 'x' },
          events: [one],
        })
      ).status,
    ).toBe(400);
  });

  it('limits events per IP by batch size: full batches run out before single pings would', async () => {
    const ctx = await buildApp({ rateLimiter: new MemoryRateLimiter(() => 1_000_000) });
    const one = {
      event: 'page_view',
      occurredAt: new Date().toISOString(),
      props: { path: '/', locale: 'en' },
    };
    const batch = (n: number) => ({
      source: 'web',
      anonymousId: randomUUID(),
      consent: { analytics: true, version: '2026-11' },
      events: Array.from({ length: n }, () => one),
    });
    const fullBatches = EVENTS_ROWS_RATE.limit / EVENTS_PER_BATCH; // 24 × 25 = 600 events
    for (let i = 0; i < fullBatches; i += 1)
      expect((await post(ctx, batch(EVENTS_PER_BATCH))).status).toBe(202);
    const refused = await post(ctx, batch(1));
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0);
    // 24 requests is well under the request cap: it was the event budget that refused.
    expect(fullBatches).toBeLessThan(EVENTS_RATE.limit);

    // Single-event pings cost one each: the same number of requests stays within budget.
    const pings = await buildApp({ rateLimiter: new MemoryRateLimiter(() => 1_000_000) });
    for (let i = 0; i <= fullBatches; i += 1) expect((await post(pings, batch(1))).status).toBe(202);
  });
});
