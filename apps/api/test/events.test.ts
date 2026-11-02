/**
 * Event ingestion (spec 12): the shared registry decides what is stored; unknown events, invalid props and extra
 * fields (e.g. a phone number) are dropped; nothing without analytics consent; stale client clocks are clamped.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { events } from '@mechdost/db/repo';
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
      ],
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ stored: 2, rejected: 3 });
    const rows = (await ctx.db.select().from(events)).filter((r) => r.anonymousId === anonymousId);
    expect(rows.map((r) => r.event).sort()).toEqual(['add_to_cart', 'page_view']);
    expect(rows.every((r) => r.source === 'web' && r.consentVersion === '2026-11')).toBe(true);
    const cart = rows.find((r) => r.event === 'add_to_cart')!;
    expect(Date.now() - cart.occurredAt.getTime()).toBeLessThan(60_000); // 2020 clamped to the receive time
    expect(JSON.stringify(rows)).not.toContain('9876543210');
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
      events: Array.from({ length: 51 }, () => one),
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
});
